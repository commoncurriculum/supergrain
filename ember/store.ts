import { get, set } from "@ember/object"
import Evented from "@ember/object/evented"
import { begin, end, later } from "@ember/runloop"
import Service, { inject as service } from "@ember/service"
import { isNone } from "@ember/utils"
import * as Sentry from "@sentry/browser"
import { generateFullStorySessionUrl } from "cc-frontend/app"
import { Narrative } from "cc-frontend/lib/actions/create-narrative"
import ObjectId from "cc-frontend/lib/object-id-gen"
import { PreparedAction } from "cc-frontend/models/action"
import { TypeToModel } from "cc-frontend/models/store"
import { Queue } from "cc-frontend/utils/queue"
import { task, timeout } from "ember-concurrency"
import { taskFor } from "ember-concurrency-ts"
import Cookies from "js-cookie"
import { assign, forEach, includes, isNil, map, partial } from "lodash-es"
import { resolve } from "rsvp"
import allActions from "../lib/actions/all"
import { PatchModel } from "../lib/patch-updater"
import type MemoryEngine from "./memory-engine"
import type Session from "./session"

/** How often we loop through out store checking for stale documents */
const CHECK_STALENESS_EVERY = 1000 * 60 * 10 // 10 minutes

/** Have a lower bound of how many times we can call the fn */
const CHECK_STALENESS_NO_MORE_THAN = 1000 * 60 * 2 // 2 minutes.

/** At what point we ask the server to see if it has a new revision. */
const DOCUMENT_STALE_AFTER = 1000 * 60 * 30 // 30 minutes

interface OptimisticPatchData {
  patch: PatchModel
  rewind: () => void
}

// export default Service.extend(Evented, {
export default class Store extends Service.extend(Evented) {
  sequenceNumber = 0
  undoSequenceNumber = 0
  lastActionOccuredAt = new Date()
  REDUX_DEV_TOOLS = null

  /**
   * Maps modelKey(patch) to a queue of all optimistic patches we've applied to that model,
   * i.e., patches we've applied locally that have not yet been acked by the server.
   * applyPatchWithServerReconciliation uses this to maintain the correct optimistic state.
   */
  private readonly optimisticQueues = new Map<string, Queue<OptimisticPatchData>>()

  @service finder
  @service fastboot
  @service declare memoryEngine: MemoryEngine
  @service persister
  @service declare session: Session
  @service socket
  @service undo

  /**
   * Runs immediately upon the store service being instantiated, checks the window for redux dev tools,
   * and then sets the service property REDUX_DEV_TOOLS to the redux extension
   *
   * @return undefined
   */
  constructor(...args) {
    super(...args)

    // @ts-ignore:
    if (window.__REDUX_DEVTOOLS_EXTENSION__) {
      set(
        this,
        "REDUX_DEV_TOOLS",
        // @ts-ignore
        window.__REDUX_DEVTOOLS_EXTENSION__.connect({
          actionsBlacklist: [],
        })
      )
    }

    // Create an anonymous user for analytics events, which use userId = "anonymous"
    // when the session is not logged in and error if they don't find a User with that id.
    this.insertDocument({
      id: "anonymous",
      type: "user",
      attributes: {
        firstName: null,
        lastName: null,
        email: null,
      },
    })

    this.checkStalenessLoop()
  }

  checkStalenessLoop() {
    if (this.fastboot && this.fastboot.isFastBoot) return
    setTimeout(() => {
      // We don't need to check staleness if the browser doesn't have focus. Instead,
      // we'll do that immediately if the browser gains focus via the function in
      let hasFocus = this.socket.isBlurred !== true && document.visibilityState !== "hidden"
      if (hasFocus) taskFor(this.checkStaleness).perform()
      this.checkStalenessLoop()
    }, CHECK_STALENESS_EVERY)
  }

  /**
   * This goes through and makes sure we have the most recent versions of all our documentns
   * It will run at most MAX_CHECK_TIMEOUT which I'm setting to 5 minutes initially.
   * In socket-subscriber, I'm triggering it when the tab receives focus.
   *
   * The goal is that even if our socket is new and our data is old (no idea why this happens),
   * we'll be sure to have the most recent up to date documents at
   */
  @task({ keepLatest: true })
  *checkStaleness(opts = { ignoreTimeSinceFetch: false }) {
    let startCheck = performance.now()
    let docsIteratedOver = 0
    let docsThatWereChecked = 0
    let docsThatWereStale = 0

    // Initially, I don't want to check card-stack-summary as there can be thousand+ (100s per class * n classes)
    // Instead, I'd like to just check the big ones -- course, planbook card-stack, group, user, etc
    // As we see how this works, we can take out this limitation
    let typesToCheck: Array<keyof TypeToModel> = [
      "card-stack",
      "class-website",
      "course",
      "fiscal-group",
      "group",
      "planbook",
      "rotation-calendar",
      "user",
    ]
    let now = new Date()
    forEach(typesToCheck, (type) => {
      forEach(this.memoryEngine.rawStore[type], (doc, id) => {
        docsIteratedOver++
        let timeSinceFetch = doc?.meta?.requestedAt
          ? now.valueOf() - dateFns.parse(doc?.meta?.requestedAt)?.valueOf()
          : null
        if (
          !isNil(timeSinceFetch) &&
          !isNaN(timeSinceFetch) &&
          (opts.ignoreTimeSinceFetch === true || timeSinceFetch > DOCUMENT_STALE_AFTER)
        ) {
          docsThatWereChecked++
          this.socket.checkStaleness(type, id).then(({ _revision }) => {
            if (_revision === null) return
            // Refetch the document if we hae an old doc
            // Update the last update from server as we can confirm we're current
            let ourRevision = doc?.attributes?._revision
            if (_revision > ourRevision) {
              console.log(
                `We have a stale document: ${type}:${id}. We have ${ourRevision}. We need ${_revision}.`
              )
              docsThatWereStale++
              this.find(type, id, true)
            } else if (_revision === ourRevision) {
              // update the requestedAt as it's now as if we just got it from the server -- we know the _revision
              // is the same
              set(doc, "meta.requestedAt", now.toISOString())
            }
          })
        }
      })
    })
    let endCheck = performance.now()
    let timeTaken = endCheck - startCheck
    console.log(`Staleness Check Complete.`)
    later(() => {
      console.log(
        `Iteration took: ${timeTaken}ms. Documents Scanned: ${docsIteratedOver}. Documents Checked: ${docsThatWereChecked}. Stale Documents: ${docsThatWereStale}`
      )
    }, 3000)
    yield timeout(CHECK_STALENESS_NO_MORE_THAN)
  }

  /**
   * Safeguards against sending an unknown/undefined action. Checks if actionName exists in codebase.  If it is a known action, the corresponding
   * action object and the payload are sent through as params to dispatchAction(). If not, an error is thrown in the console.
   *
   * @param  actionName [string]
   * @param  payload    [object] - contents vary based on action
   * @return actionDoc [object] - See ActionDoc interface below for keys/values
   */
  dispatch(actionName: string, payload: object) {
    let action = allActions[actionName]
    if (action === undefined) console.error(`${actionName} does not exist`, actionName)
    action.name = actionName

    return this.dispatchAction(action, payload)
  }

  /**
   * This function will be called from components/helpers/services as the first step to changing/updating/interacting with the backend.
   * Assembles object, offering the option of null values for patches/undoPatches, and narrative that is passed
   * onto dispatchPreparedAction (see below).
   *
   * @param  action  [object] with keys name, payload/params, patches, undoPatches, and narrative. Exisitng actions can be found in app/lib/actions
   * @param  payload [object] - contents vary based on action - generally includes an id of the object/document to change in db
   * @return actionDoc [object] - See ActionDoc interface below for keys/values
   */
  dispatchAction(
    action: { name: string; patches?: any; undoPatches?: any; narrative?: any },
    payload: object
  ) {
    return this.dispatchPreparedAction({
      name: action.name,
      payload: payload,
      patches: action.patches ? action.patches(payload) : null,
      undoPatches: action.undoPatches ? action.undoPatches(payload) : null,
      narrative: action.narrative ? partial(action.narrative, payload) : null,
    })
  }

  /**
   * Prepares action object with all necessary information to be sent to the backend.
   * This is the launchpad for sending actions from the frontend to the backend. Sends
   * Sentry information (breadcrumb) to track user actions and make debugging easier in the event of an error.
   * Puts relevant info as params into generateActionDoc() to begin documenting/logging the action.
   * With the returned actionDoc from the generate function, patches are applied (see function below for more info),
   * sends actionDoc to the backend through a socket with the persister service, if there are no matching patches,
   * triggers a named event for an action and passes the action name, payload, and action doc to functions listening for this action.
   * Sends the action payload to the memoryEngine for storage in local memory
   *
   * @param  preparedAction object with important information from the actionObject
   * @return  actionDoc [object] - see interface below for keys/values
   */
  dispatchPreparedAction(preparedAction: PreparedAction) {
    Sentry.addBreadcrumb({
      message: preparedAction.name,
      category: "beforeAction",
    })

    Sentry.setContext("Prepared Action", {
      payload: preparedAction.payload,
      patches: "here",
    })

    this.sequenceNumber++
    let actionId = ObjectId.create()
    let userId = this.session.userId || "anonymous"
    let sessionId = this.session.id || "anonymous"

    let patches = timestampPatches(preparedAction.patches, actionId)
    let narrative = preparedAction.narrative
      ? preparedAction.narrative(this.findInMemory.bind(this), userId)
      : null

    let actionDoc = generateActionDoc(
      actionId,
      preparedAction.name,
      patches,
      narrative,
      userId,
      sessionId,
      this.session.fiscalGroupId,
      this.sequenceNumber,
      // @ts-ignore
      Math.floor((new Date() - this.lastActionOccuredAt) / 1000) // seconds since last action
    )
    this.undo.addWithPatches(actionId, preparedAction.undoPatches, narrative)
    this.applyPatches(actionDoc)
    this.persister.persist(actionDoc)
    this.trigger("action", preparedAction.name, preparedAction.payload, actionDoc)

    Sentry.setContext("Prepared Action", null)

    // @ts-ignore:
    if (get(this, "REDUX_DEV_TOOLS") && window.__ENABLE_REDUX_DEVTOOLS__ === true) {
      // @ts-ignore
      get(this, "REDUX_DEV_TOOLS").send(
        { type: name, payload: preparedAction.payload },
        // @ts-ignore
        get(this, "memoryEngine.__store__")
      )
    }
    return actionDoc
  }

  /**
   * Checks for patches and begins a runLoop, loops through the patches and if the patch has no id, throws an error.
   * Checks if the patch is in the store of the memoryEngine and if it is, sets the revisionAtCreation key on the patch
   * to the value of the _revision key in the returned document.  Ends runLoop.
   *
   * @param actionDoc [object] - see interface below for keys/values
   * @return undefined
   */
  applyPatches(actionDoc: ActionDoc): void {
    if (actionDoc.attributes.patches && actionDoc.attributes.patches.length > 0) {
      // this function is commented out in memoryEngine - do we still need this line?
      get(this, "memoryEngine").checkpoint()
      begin()
      actionDoc.attributes.patches.forEach((patch) => {
        if (isNone(patch.document.id)) {
          console.log("Problematic Patch", patch)
          throw new Error("Invalid Patch -- no id")
        }
        if (this.applyPatchToStore(patch)) {
          // MUTATE patch. Probably a better way to do this.
          patch.revisionAtCreation = get(
            this.findInMemory(patch.document.modelType, patch.document.id),
            // @ts-ignore
            "attributes._revision"
          )
        }
      })
      end()
    }
  }

  /**
   * Checks the memoryEngine to see if the desired model is already there, returns if it is,
   * if not, use finder service to ask backend to send requested model here.
   *
   * @param  modelName    [string]
   * @param  id           [string]
   * @param  forceRefresh [boolean - optional]
   * @return              [Promise Object] - as it waits for the finder to access the requested model
   */
  find(modelName: keyof TypeToModel, id: string, forceRefresh?: boolean) {
    let model = get(this, "memoryEngine").find(modelName, id)
    later(() => {
      if (this.isDestroyed || this.isDestroying) return
      if (this.fastboot && this.fastboot.isFastBoot) return
      get(this, "socket").subscribe(modelName, id)
    }, 1000)
    // if (model) return new Ember.RSVP.Promise((resolve, _reject) => resolve(model))
    if (model && forceRefresh !== true) return resolve(model)
    return get(this, "finder").find(modelName, id)
  }

  /**
   * Checks to see if desired model is in memory
   *
   * @param  modelName [description]
   * @param  id        [description]
   * @return           [object/undefined] requested model, if available
   */
  findInMemory(modelName, id) {
    return get(this, "memoryEngine").find(modelName, id)
  }

  /**
   * Resets the in-memory store using the memoryEngine service which resets its store, history, and undo/redo list to empty arrays
   *
   * @return undefined
   */
  clearMemory() {
    return get(this, "memoryEngine").reset()
  }

  /**
   * Applies a patch from a local action.
   *
   * Checks to see if the patch is in the store of the memoryEngine. If the patch there and it says a patch was created returns false
   * if not, make a patch in the memoryEngine and returns true.  Dictates internal revision count of patch (see applyPatches).
   * Triggers a named event "patch" so any other listening functions can use the path parameter for its own use.
   *
   * @param  patch [description]
   * @return       [boolean]
   */
  applyPatchToStore(patch) {
    let model = get(this, "memoryEngine").find(patch.document.modelType, patch.document.id)
    // This means it's a patch we created for a document we're not looking at,
    // so we can ignore it intead of applying it to something that doesn't exist
    if (isNone(model) && patch.isCreatePatch !== true) return false

    if (this.session.user?.content?.attributes?.featureFlags["SERVER_RECONCILIATION"]) {
      this.applyOptimisticPatch(patch)
    } else {
      get(this, "memoryEngine").patch(patch)
    }

    this.trigger("patch", patch)
    return true
  }

  applyForeignPatchToStore(patch) {
    // Check if the patch upgrades the document to a version larger than ours
    // Check that it's not our own patch applied to the document we have
    // We would want to apply our own patch if we're getting off the subway
    // and our patches are pushed up to the server. But first, a colleagues
    // changes are pushed down. Then, we want to check that
    // So, I think if the version we have was updated by our session
    // AND the patch we're applying was also updated by our session, we can ignore
    // it. If the document was last updated by a different session and we have
    // a patch from our session, we want to apply it...unless that's the one we just wrote
    //
    // We want to ignore our patches all the time unless
    // it follows a patch we didn't have when we wrote it. That means something was injected
    //
    // So, a patch has a version it was written against. We go, "oh, our patch.
    // Which version was it written against?" And then we're like, "Oh, it was written
    // against version 26. Well, which version do we have? We have version 26. So, we can ignore this
    // because it's a version we've applied already"
    // A situation might arise where we're like, "our patch and written against version 26.
    // We have version 36. Wow. That means that there were 10 other changes that applied. WE need to apply
    // this again since it's being applied against a different base."
    //
    let needsMisingPatch = false
    if (needsMisingPatch) {
      // this is not a method on the service
      // why is this a possible code path if it will never get here?
      get(this, "persister").requestPatch()
    } else {
      get(this, "memoryEngine").patch(patch)
      this.trigger("foreign-patch", patch)
    }
  }

  /**
   * (Re)-applies an optimistic local patch, recording it so we can rewind and replay it later.
   */
  private applyOptimisticPatch(patch: PatchModel) {
    const rewind = this.memoryEngine.patch(patch)

    // Since this patch is optimistic (not yet acked by the server), we need to remember how
    // to rewind and replay it, in case the server processes a concurrent patch first.
    // See applyPatchWithServerReconciliation.
    let queue = this.optimisticQueues.get(modelKey(patch))
    if (queue === undefined) {
      queue = new Queue()
      this.optimisticQueues.set(modelKey(patch), queue)
    }
    queue.push({ patch, rewind })
  }

  applyPatchWithServerReconciliation(
    patch: PatchModel,
    id: string,
    type: "patch" | "patch-summary"
  ) {
    // Our goal is to end up in the state: the server's latest state, with our optimistic
    // (not-yet-acked) local patches applied on top.
    // To end up there, we:
    // 1. Rewind all optimistic local patches (to match the server's state before the current patch).
    // 2. Apply the current patch (to match the server's new state).
    // 3. Re-apply all optimistic local patches. Note that if `patch` is our own patch
    // echoed back to us, it is now no longer optimistic, so we don't re-apply it.
    // This technique is sometimes called "server reconciliation"; see
    // https://mattweidner.com/2024/06/04/server-architectures.html#1-server-reconciliation

    // Shortcut: If patch is our oldest optimistic patch echoed back to us,
    // just mark at as no longer optimistic.
    const queue = this.optimisticQueues.get(modelKey(patch))
    const oldestOptimistic = queue?.head()
    if (oldestOptimistic && oldestOptimistic.patch.id === id) {
      queue!.shift()
      return
    }

    // 1. Rewind all optimistic local patches.
    const optimisticPatchData = queue?.values() ?? []
    queue?.clear()
    for (let i = optimisticPatchData.length - 1; i >= 0; i--) {
      optimisticPatchData[i].rewind()
    }

    // 2. Apply the current patch.
    if (type === "patch-summary") {
      // The server only sends us a patch-summary when echoing our own patch back to us.
      // I *think* that will always be our oldest optimistic patch, hence handled by the shortcut above.
      // As a backup, though, let's handle this case but log that it happened.
      // We need to replace the patch-summary with our copy of the patch.
      console.error("Server echoed our patch-summary out of order", id, modelKey(patch))
      const optimisticPatch = optimisticPatchData.find((data) => data.patch.id === id)?.patch
      if (optimisticPatch === undefined) {
        console.error("  Local patch for patch-summary not found. Duplicate ack from server?")
        return
      }
      patch = optimisticPatch
    }

    this.memoryEngine.patch(patch)

    // 3. Re-apply all optimistic local patches.
    for (let i = 0; i < optimisticPatchData.length; i++) {
      if (optimisticPatchData[i].patch.id === id) {
        // Somehow, the server echoed our non-oldest optimistic patch back to us.
        // I guess this can happen if it receives actions out-of-order after reconnecting.
        // Log that this happened and don't re-apply the patch, since it's no longer optimistic.
        console.error(
          "Server echoed our patch out of order",
          id,
          modelKey(patch),
          `${i}/${optimisticPatchData.length}`
        )
      } else {
        // This function will refill the queue with our remaining optimistic patches.
        this.applyOptimisticPatch(optimisticPatchData[i].patch)
      }
    }

    // Notify
    if (type !== "patch-summary") this.trigger("foreign-patch", patch)
  }

  /**
   * Updates exisitng document in memoryEngine store or makes a new one
   * @param  doc [object] - document object
   * @return     [object] - updated document object if it already exists, otherwise, just the document
   */
  insertDocument(doc) {
    // I had to do this because things were failing in tests
    if (doc.meta === undefined) {
      set(doc, "meta", {})
    }
    set(doc, "meta.lastUpdateFromServer", new Date())
    get(this, "memoryEngine").insert(doc)
    // If we're overwriting an existing doc (e.g. from checkStaleness), we don't
    // know which optimistic local updates are included in the server's new version.
    // It seems safest, and reasonably likely, to assume that all of them are included.
    this.optimisticQueues.get(`${doc.type}.${doc.id}`)?.clear()
  }
}

function timestampPatches(patches, actionId) {
  return map(patches, (patch) => {
    patch.id = ObjectId.create()
    patch.actionId = actionId
    // @ts-ignore:
    patch.timeAtCreation = dateFns.format(new Date())
    patch.revisionAtCreation = null
    return patch
  })
}

export interface ActionDoc {
  id: string
  type: "action"
  attributes: ActionDocAttributes
  relationships: ActionDocRelationships
}

interface ActionDocAttributes {
  name: string
  patches: Array<PatchModel>
  narrative: Narrative
  attemptCount: number
  sync: {
    status: string
    failureReason: string | null
    hasFailed: boolean
    attemptCount: number
    failureCount: number
    retryAt: Date | null
    isUserFacing: boolean
  }
  timing: {
    clientCreatedAt: Date
    clientSentAt: Date | null
    serverReceivedAt: Date | null
    secondsSinceLastClientAction: number
    fullStorySessionUrl: string | null
  }
  order: {
    amongAllClientActions: number
    amongPublishedClientActions: null | number
    followsPublishedActionId: null | string
  }
}

interface ActionDocRelationships {
  user: object
  session: object
}

function generateActionDoc(
  id,
  actionName,
  patches,
  _narrative,
  userId,
  sessionId,
  fiscalGroupId,
  sequenceNumber,
  secondsSinceLastClientAction
): ActionDoc {
  let sessionUrl = generateFullStorySessionUrl(true)

  let narrative = _narrative || { context: {} }

  narrative.context = assign({}, narrative.context, {
    currentUrl: window.location?.href ?? "fastboot",
    fbp: Cookies.get("_fbp"),
    fbc: Cookies.get("_fbc"),
    groupId: fiscalGroupId,
  })

  narrative.url =
    narrative.url || (typeof document !== "undefined" ? document.location.href : "fastboot")

  // This is a hacky way of doing it, for sure.
  // If it doesn't have patches, it's just an analytics style action.
  // if it has the word "INTERMEDIATE", that's one of those actions as someone is typing
  let isUserFacing = patches && patches.length > 0 && !includes(actionName, "INTERMEDIATE")

  return {
    id: id,
    type: "action",
    attributes: {
      name: actionName,
      patches: patches,
      narrative: narrative,
      attemptCount: 0,
      sync: {
        status: "waiting",
        failureReason: null,
        hasFailed: false,
        attemptCount: 0,
        failureCount: 0,
        retryAt: null,
        isUserFacing: isUserFacing,
      },
      timing: {
        // @ts-ignore:
        clientCreatedAt: dateFns.format(new Date()),
        clientSentAt: null,
        serverReceivedAt: null,
        secondsSinceLastClientAction: secondsSinceLastClientAction,
        fullStorySessionUrl: sessionUrl,
      },
      order: {
        amongAllClientActions: sequenceNumber,
        amongPublishedClientActions: null,
        followsPublishedActionId: null,
      },
    },
    relationships: {
      user: { data: { id: userId, type: "user" } },
      session: { data: { id: sessionId, type: "session" } },
    },
  }
}

function modelKey(patch: PatchModel): string {
  // If changing: Also update insertDocument.
  return `${patch.document.modelType}.${patch.document.id}`
}

declare module "@ember/service" {
  interface Registry {
    store: Store
  }
}
