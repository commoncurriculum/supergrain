import { get, set } from "@ember/object"
import { cancel, later } from "@ember/runloop"
import { EmberRunTimer } from "@ember/runloop/types"
import Service, { inject as service } from "@ember/service"
import * as Sentry from "@sentry/browser"
import ObjectId from "cc-frontend/lib/object-id-gen"
import { JsonApiError, JsonApiErrorCodes } from "cc-frontend/models/json-api-error"
import { task, timeout } from "ember-concurrency"
import { taskFor } from "ember-concurrency-ts"
import Cookies from "js-cookie"
import _ from "lodash"
import { filter, forEach, includes } from "lodash-es"
import { Promise } from "rsvp"
import { tracked } from "tracked-built-ins"
import { handleError, notifySentry, postError } from "../app"
import { default as ENV, default as config } from "../config/environment"
import { Channel, LongPoll, Socket } from "../lib/phoenix/index"
// import { LongPoll, Socket } from "../lib/phoenixold/phoenix"
import { generateFullStorySessionUrl } from "cc-frontend/app"
import { getAmplitudeSessionId } from "cc-frontend/lib/amplitude"
import compareVersions from "compare-versions"
import * as TypedDateFns from "date-fns"
import { track } from "./callbacks/action/analytics"
import Finder from "./finder"
import Rpc from "./rpc"
import Session from "./session"
import SocketSubscriber from "./socket-subscriber"
import Store, { ActionDoc } from "./store"

// If it's only been one minute since we blurred, we don't need to check again.
// This isn't designed for quick switching between tabs. This is designed for coming back
// to a tab after it's been gone
const MAX_ALLOWED_BLUR_TIME = 120

export default class SocketService extends Service {
  @service declare session: Session
  @service declare store: Store
  @service declare finder: Finder
  @service declare rpc: Rpc
  @service declare socketSubscriber: SocketSubscriber
  @service fastboot
  @service inAppNotice
  @service query

  failedActionAlertOpen = false
  hasSentFailedActions = false
  hasEncounteredFatalError = false
  showBusySyncingModal = false
  isReconnectingToSocket = false
  @tracked isOnline = true

  activeStartedAt: Date = new Date()
  activeEndedAt: Date = new Date()
  isActive = false
  isOnlineStartedAt: null | Date = null
  isOnlineEndedAt: null | Date = null

  subscriptions: Array<string> = []
  querySubscriptions: Array<string> = []
  actionCount = 0
  actionCountAtFocus = 0
  userFacingActionCount = 0
  lastActionId: string | null = null
  syncedUserFacingActionsCount = 0
  actions: Array<ActionDoc> = []
  recentlyPublishedActions: Array<ActionDoc> = []
  socket: null | Socket = null
  channel: undefined | Channel = undefined
  channelErrorCount = 0
  isRedirectingAfterSignIn = false
  socketErrorCount = 0
  socketOnCloseRef: null | string = null
  socketOnErrorRef: null | string = null
  socketOnOpenRef: null | string = null
  lastTransportUsed: "WEBSOCKET" | "LONGPOLL" | null = null

  @tracked windowIsUnloading = false

  initiate() {
    if (this.fastboot.isFastBoot) return
    if (ENV.environment === "test") return
    this._pollActions()
    this.connect()
    this.socketSubscriber.heartbeatLoop()
    this._handleActiveStart()
    taskFor(this._notifyIsSyncing).perform()
    this._listenToActiveEvents()
    this._pollForActivity()
    this._guardBeforeUnload()
  }

  private _listenToActiveEvents() {
    // Add Idle timer
    if (document) {
      let userActiveEvents = [
        "change",
        "keydown",
        "mousedown",
        "mouseup",
        "mousemove",
        "orientationchange",
        "scroll",
        "touchend",
        "touchmove",
        "touchstart",
      ]
      let pageActiveEvents = ["pageshow", "resume", "focus"]
      forEach([...userActiveEvents, ...pageActiveEvents], (eventName) => {
        document.addEventListener(eventName, () => {
          this._handleActiveStart()
        })
      })

      let pageUnactiveEvents = ["pagehide", "freeze", "blur"]

      forEach(pageUnactiveEvents, (eventName) => {
        document.addEventListener(eventName, () => {
          this._handleActiveEnd()
        })
      })

      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          this._handleActiveEnd()
        } else {
          this._handleActiveStart()
        }
      })
    }
  }

  private _pollForActivity() {
    // ------------------------------------
    // CHECK FOR ACTIVITY.
    // ------------------------------------
    setInterval(() => {
      let diffInSeconds = TypedDateFns.differenceInSeconds(new Date(), this.activeStartedAt)
      this.isActive === true && diffInSeconds > 15
        ? this._handleActiveEnd()
        : this._handleActiveStart()
    }, 1000 * 15) // 15 seconds

    // ------------------------------------
    // CHECK IF WE'RE OFFLINE
    // ------------------------------------
    setInterval(() => {
      if (this.isOnlineEndedAt === null) return
      let diffInSeconds = TypedDateFns.differenceInSeconds(
        this.isOnlineStartedAt || new Date(),
        this.isOnlineEndedAt || new Date()
      )

      // This means that short blips won't trigger the offline notice -- only
      // if we've failed 6 times which at the retry interval means after 23 seconds.
      if (diffInSeconds > 25) this.recordDisconnectedStatus()
    }, 1000 * 15) // 15 seconds

    // ------------------------------------
    // CLOSE INACTIVE SOCKETS
    // Set a timer for 5 minutes and check if we've been inactive for 15 minutes. If so, close the socket.
    // ------------------------------------
    setInterval(() => {
      let diffInSeconds = TypedDateFns.differenceInSeconds(new Date(), this.activeEndedAt)
      if (this.isActive === false && diffInSeconds > 60 * 15) {
        this._disconnectSocket()
      }
    }, 1000 * 60 * 5) // Check every 5 minutes

    // ------------------------------------
    // TRY WEBSOCKETS. We should try a websocket after a while
    // ------------------------------------
    setInterval(() => {
      if (this.socket?.transport === LongPoll) {
        taskFor(this.reconnectToSocket).perform()
      }
    }, 1000 * 60 * 10) // Try after 10 minutes
  }

  private _guardBeforeUnload() {
    if (window && window.addEventListener) {
      window.addEventListener("beforeunload", (e) => {
        this.windowIsUnloading = true
        // We set this so that we know not to check for unsynced actions
        if (this.isRedirectingAfterSignIn === true) return
        // no support for custom messages
        // https://stackoverflow.com/questions/38879742/is-it-possible-to-display-a-custom-message-in-the-beforeunload-popup?answertab=active#tab-top
        let lengthOfActions = this.actions.length
        if (lengthOfActions > 0 && get(this, "hasEncounteredFatalError") !== true) {
          let confirmationMessage = `If you exit now, you'll lose work. You have ${lengthOfActions} left to sync. Try closing the browser after another few seconds.`
          e.returnValue = confirmationMessage // Gecko, Trident, Chrome 34+
          return confirmationMessage // Gecko, WebKit, Chrome <34
        } else {
          return false
        }
      })
    }
  }

  private _disconnectSocket() {
    if (this.socket) {
      this.socket.off([this.socketOnCloseRef, this.socketOnErrorRef, this.socketOnOpenRef])
      // The typing doesn't acknowledge it accepts optional params
      // @ts-expect-error
      this.socket.disconnect()
    }
    this.socket = null
  }

  _handleActiveStart() {
    if (document.hasFocus() === false) return
    if (this.isActive === true) return

    // Store our state
    this.isActive = true
    this.actionCountAtFocus = this.actionCount
    this.activeStartedAt = new Date()

    // Make sure we're connected
    if (this.socket === null || includes(["closing", "closed"], this.socket.connectionState())) {
      taskFor(this.reconnectToSocket).perform()
    }

    // Ping the server
    this.socketSubscriber.heartbeat()

    // if It's been a while, check that we don't have stale documents
    let timeSinceBlur = TypedDateFns.differenceInSeconds(this.activeStartedAt, this.activeEndedAt)
    if (timeSinceBlur > MAX_ALLOWED_BLUR_TIME) taskFor(this.store.checkStaleness).perform()

    console.log(`Active Start: ${this.activeStartedAt}`)
  }

  _handleActiveEnd() {
    if (this.isActive === false) return
    this.isActive = false
    this.activeEndedAt = new Date()
    let sessionTimeInSeconds = TypedDateFns.differenceInSeconds(
      this.activeEndedAt,
      this.activeStartedAt
    )

    if (sessionTimeInSeconds > 0 && this.channel) {
      this.channel.push("new-session-moment", {
        startedAt: TypedDateFns.formatISO(this.activeStartedAt),
        endedAt: TypedDateFns.formatISO(this.activeEndedAt),
        actionCount: this.actionCount - this.actionCountAtFocus,
        seconds: sessionTimeInSeconds,
        fullStorySessionUrl: generateFullStorySessionUrl(),
      })
    }
    console.log(`Active End: ${sessionTimeInSeconds} seconds at ${this.activeEndedAt}`)
  }

  connect(shouldLongPoll = false) {
    if (ENV.environment === "test") return
    if (this.fastboot.isFastBoot) return
    console.log("CONNECT")
    try {
      if (this.socket) return
      console.log(`Starting connection over ${shouldLongPoll ? "long polling" : "websocket"}`)
      this._createSocket(shouldLongPoll)
      this.socket!.connect(undefined)
      this._connectToChannel()
    } catch (e) {
      console.log("Error connecting to socket", e)
    }
    return this.socket
  }

  _createSocket(shouldLongPoll) {
    let transport = shouldLongPoll ? LongPoll : null
    this.lastTransportUsed = shouldLongPoll ? "LONGPOLL" : "WEBSOCKET"

    this.socket = new Socket(ENV.SOCKET_URL, {
      transport: transport,
      longPollFallbackMs: 5000,
      logger: (kind: string, msg: string, data: any) => {
        if (kind === "transport" || kind === "channel") {
          console.log(`${kind}: ${msg}`, data)
        }
      },
      params: {
        id: this.session.id,
        clientVersion: ENV.CLIENT_VERSION,
        userAgent: navigator.userAgent,
        browserId: this.session.browserId,
        amplitudeSessionId: getAmplitudeSessionId(),
      },
      longpollerTimeout: 20000,
      reconnectAfterMs: function (tries) {
        let time = [50, 1000, 6000, 12000, 24000][tries - 1] || 30000
        let jitter = time * 0.2 * Math.random() // add 0-2% jitter so everything doesn't connect at the exact same ms.
        // Actually,  the only accurate place to get how many tries
        this.socketErrorCount = tries
        return time + jitter
      },
    })

    /**
     * This is called twice if we're long polling. Why? Great question and I spent a few hours o
     * of my life figuring it out. Hours that will haunt me. forever.
     *
     * The first callback is from the xhr on ready state change callback
     * The second callback is from the xhrRequest callback.
     *
     * Both of these are in phoenix.js
     *
     * The implication is that the socketErrorCount will be double counted if we're using
     * long polling. This isn't a problem per se, but it is very odd and surprising.
     */
    this.socketOnErrorRef = this.socket.onError((reason) => {
      this.socketErrorCount++

      // Just give up
      if (this.socketErrorCount > 200) this.reloadPage()
      // This means that short blips won't trigger the offline notice -- only
      // if we've failed 6 times which at the retry interval means after 23 seconds.
      if (this.socketErrorCount > 5) this.recordDisconnectedStatus()
    })

    this.socketOnCloseRef = this.socket.onClose((reason) => {
      this.socketErrorCount++
      this.recordDisconnectedStatus()
      console.log(
        `Socket closed. Is Online: ${window.navigator.onLine}. Error Count: ${this.socketErrorCount}`,
        reason
      )
    })

    this.socketOnOpenRef = this.socket.onOpen(() => {
      // We reset this when we've connected successfully
      this.socketErrorCount = 0

      // Let the user know we're online
      this.recordConnectedStatus()

      console.log("Connected to socket")

      // Check to make sure we don't have any stale documents that came in
      // while we were offline or that hit the server before the server
      // had our subscriptions
      later(() => {
        taskFor(this.store.checkStaleness).perform({ ignoreTimeSinceFetch: true })
        // Make it a bit random so we don't completely swamp
        // the server when ever it restarts
      }, Math.floor(Math.random() * 30000))
    })
  }

  recordConnectedStatus() {
    if (this.isOnline === false) {
      this.isOnline = true
      this.isOnlineStartedAt = new Date()
      this.isOnlineEndedAt = null
    }
  }

  recordDisconnectedStatus() {
    if (this.isOnline === true) {
      this.isOnline = false
      this.isOnlineEndedAt = new Date()
    }
  }

  /**
    Works to reconnect.
    - Leaves the channel
    - Disconnects from the socket
    - Logs
    - Tries to connect again
  */
  @task({ drop: true })
  *reconnectToSocket() {
    console.log("reconnect to socket")
    let diffInSeconds = TypedDateFns.differenceInSeconds(new Date(), this.activeEndedAt)
    // If it's been 24 hours since the last active event, the connection is stale.
    if (diffInSeconds > 60 * 60 * 24) {
      this.reloadPage()
    }

    // Make sure that if we have any errors, we don't lock ourselves out of reconnecting.
    // We do this by wrapping this in a try/catch and setting the guard (isReconnectingToSocket) to false
    // so we can try to hit this function again without any issues
    if (this.channel) this.channel.leave()
    // Reset the error count since we're leaving the channel
    this.channelErrorCount = 0
    this._disconnectSocket()

    this.connect()
  }

  reloadPage() {
    // Not sure if this works if the tab is on a background tab, so putting the swal in just in case
    window.location.reload()
    if (window && window.swal) {
      window
        .swal({
          title: "The connection has grown stale.",
          text: `Refresh the page and we'll make a new connection to the server.`,
          type: "info",
          showCancelButton: false,
        })
        .then(() => {
          window.location.reload()
        })
        .catch(() => {
          window.location.reload()
        })
    }
  }

  /**
   * The internal logic of the Channel is it will keep reconnecting as long as the socket is open.
   * I was originally going to change this to make sure it reconnects, but that's already taken care of
   */
  _connectToChannel() {
    console.log(`Connecting to channel: sessions:${this.session.id}`)
    this.channel = this.socket?.channel(`sessions:${this.session.id}`, {
      token: this.session.token,
      subscriptions: this.subscriptions,
      querySubscriptions: this.querySubscriptions,
      userAgent: navigator.userAgent,
      clientVersion: ENV.CLIENT_VERSION,
    })

    if (this.channel === undefined) return

    this.channel.onError((reason) => {
      this._onChannelError("ERROR", reason)
    })

    // From the docs:
    // `onClose` hooks are invoked only in two cases. 1) the channel explicitly
    // closed on the server, or 2). The client explicitly closed, by calling
    // Becuase of that, we don't call onChannelError
    // But we do increment the channel Error count
    this.channel.onClose((reason) => {
      this.channelErrorCount++
      console.log("Channel Closed Gracefully", reason)
    })

    this.channel
      .join()
      .receive("ok", (resp) => {
        console.log(
          `Connected to channel. Syncing server "${resp.hostname}" is running ${resp.serverVersion} on release ${resp.release}.`
        )
        // @ts-ignore
        if (compareVersions(resp.serverVersion, "5.4.139", ">") && this.session.token) {
          this.refreshToken()
        }
        this.recordConnectedStatus()
        this.channelErrorCount = 0
        this.socketSubscriber.heartbeat()
      })
      .receive("error", (resp) => {
        this._onChannelError("RECEIVE_ERROR", resp)
      })
      .receive("timeout", (resp) => {
        this._onChannelError("TIMEOUT", resp)
      })

    this.channel.on("new-model-update", (patch) => {
      try {
        this.socketSubscriber.onModelUpdate(patch)
      } catch (e) {
        handleError(e)
      }
    })

    this.channel.on("new-in-app-notice", (notice) => {
      if (notice.type === "in-app-notice") {
        get(this, "inAppNotice").newNotice(notice)
      } else {
        throw Error(`notice.type "${notice.type}" is not recognized.`)
      }
    })

    this.channel.on("model-invalidation", (invalidation) => {
      get(this, "store").find(invalidation.type, invalidation.id, true)
    })

    this.channel.on("query-invalidation", (query) => {
      get(this, "query").invalidate(query.type, query.id)
    })

    this.channel.on("reload-page", () => {
      this.reloadPage()
    })
    this.channel.on("sign-out", async () => {
      await this.session.signOut()
      window.location.assign("https://www.commoncurriculum.com")
    })
  }

  _onChannelError(errorType, errorOrResponse = null) {
    this.channelErrorCount++
    if (this.channelErrorCount > 10) this.recordDisconnectedStatus()
    console.log(`Unable to join user channel: ${errorType}`)
    console.log(errorOrResponse)
  }

  /**
   *****************************************************************************************************
   * Authentication
   *****************************************************************************************************
   */

  authenticateWithToken(token) {
    if (ENV.environment === "test") return
    if (this.fastboot.isFastBoot) return
    return new Promise((resolve, reject) => {
      this._ensureChannelIsConnected()
      if (this.channel === undefined) return
      this.channel
        .push("authenticate-with-token", {
          token: token,
          clientVersion: ENV.CLIENT_VERSION,
          userAgent: navigator.userAgent,
          fbc: Cookies.get("_fbc"),
          fbp: Cookies.get("_fbp"),
        })
        .receive("ok", resolve)
        .receive("error", reject)
    })
  }

  notifyUpgradeToPro({ userId: userId }) {
    if (ENV.environment === "test") return
    if (this.fastboot.isFastBoot) return
    return new Promise((resolve, reject) => {
      this._ensureChannelIsConnected()
      if (this.channel === undefined) return
      this.channel
        .push("notify-upgrade-to-pro", { userId })
        .receive("ok", resolve)
        .receive("error", reject)
    })
  }

  refreshToken() {
    if (this.session.isPrinting) return
    return new Promise((resolve, reject) => {
      this._ensureChannelIsConnected()
      if (this.channel === undefined) return
      this.channel
        .push("refresh-token", { token: this.session.token })
        .receive("ok", (result) => {
          this.session.setToken(result.userId, result.token, this.session.isImpersonating)
          return resolve(result)
        })
        .receive("error", async (error) => {
          // Sign them out if there's an error
          await this.session.signOut()
          window.location.reload()
        })
    })
  }

  pushHeartbeat(cb) {
    this._ensureChannelIsConnected()
    if (this.channel === undefined) return
    // @ts-expect-error The args are optional
    this.channel.push("heartbeat").receive("ok", cb)
  }

  /**
   *****************************************************************************************************
   * Set syncing status
   *****************************************************************************************************
   */

  isSyncing = false
  _notifyIsSyncingTimer: EmberRunTimer | null = null;

  @task({ drop: true })
  *_notifyIsSyncing() {
    set(this, "isSyncing", true)
    yield timeout(500)
    let failedActionCount = _.filter(get(this, "actions"), (action) => {
      return (
        new Date().valueOf() - dateFns.parse(action.attributes.timing.clientSentAt).valueOf() >
          10000 || action.attributes.sync.status === "failed"
      )
    }).length
    if (failedActionCount > 0) {
      console.log(`😩 Failed actions: ${failedActionCount}`, get(this, "actions"))
    }

    if (failedActionCount > 5) {
      track("Show Sync Modal")
      set(this, "showBusySyncingModal", true)
    } else {
      set(this, "showBusySyncingModal", false)
    }

    if (
      _.filter(get(this, "actions"), (action) => action.attributes.sync.status === "in-flight")
        .length === 0
    ) {
      set(this, "isSyncing", false)
    }
    this._notifyIsSyncingTimer = later(() => taskFor(this._notifyIsSyncing).perform(), 2500)
  }

  willDestroy() {
    if (this._notifyIsSyncingTimer) cancel(this._notifyIsSyncingTimer)
    if (this._pollActionsTimer) cancel(this._pollActionsTimer)
    super.willDestroy()
  }

  /**
   *****************************************************************************************************
   * Subscribing
   *****************************************************************************************************
   */

  /**
   * This should be moved to another service. Components might need to subscribe
   * such as a course date subscribing to the lessonTemplateId
   */
  subscribe(modelName, id) {
    // For now, skip this in test. If we can find an easy way to mock the WS
    // we'd want to do that.
    if (modelName === null) return
    if (id === null || id === undefined) return
    if (config.environment === "test") return
    if (this.fastboot.isFastBoot) return
    if (_.includes(this.subscriptions, `${modelName}:${id}`)) return

    let subscriptionIdentifier = `${modelName}:${id}`

    this._ensureChannelIsConnected()
    if (this.channel === undefined) return
    this.channel
      .push("new-subscription", subscriptionIdentifier, 1440000)
      .receive("ok", () => this.subscriptions.push(subscriptionIdentifier))
      .receive("error", (reasons) => {
        _.pull(this.subscriptions, subscriptionIdentifier)
        console.log("Model Subscription Failed: Error ", reasons)
      })
      .receive("timeout", () => {
        _.pull(this.subscriptions, subscriptionIdentifier)
        console.log("Model Subscription Failed: Networking issue...")
      })
  }

  subscribeToQuery(type, id) {
    if (this.fastboot.isFastBoot) return
    this.querySubscriptions.push(`${type}:${id}`)
    this._ensureChannelIsConnected()
    if (this.channel === undefined) return
    this.channel
      .push("subscribe-to-query", `${type}:${id}`, 1444000)
      .receive("ok", () => true)
      .receive("error", (reasons) => {
        _.pull(this.querySubscriptions[`${type}:${id}`])
        console.log("Query Subscription Failed: Error", reasons)
      })
      .receive("timeout", () => {
        _.pull(this.querySubscriptions[`${type}:${id}`])
        console.log("Query Subscription Failed: Networking issue...")
      })
  }

  checkStaleness(type, id) {
    if (ENV.environment === "test") return
    if (this.fastboot.isFastBoot) return
    return new Promise((resolve, reject) => {
      this._ensureChannelIsConnected()
      if (this.channel === undefined) return
      this.channel
        .push("check-document-revision", { type, id })
        .receive("ok", resolve)
        .receive("error", reject)
    })
  }

  /**
   *****************************************************************************************************
   * Publishing
   *****************************************************************************************************
   */

  /**
   * For sending actions back to the server
   */
  publish(action: ActionDoc) {
    action.attributes.order.amongPublishedClientActions = this.actionCount + 1
    set(this, "actionCount", this.actionCount + 1)
    if (action.attributes.sync.isUserFacing) {
      set(this, "userFacingActionCount", this.userFacingActionCount + 1)
    }
    action.attributes.order.followsPublishedActionId = this.lastActionId
    action.attributes.timing.clientSentAt = dateFns.format(new Date())
    this.lastActionId = action.id

    this._publishNewAction(action)
  }

  _publishNewAction(action: ActionDoc) {
    if (action === undefined) return
    // If we've encounterd a fatal error, we need to not keep sending things.
    if (ENV.environment === "test") return
    if (get(this, "hasEncounteredFatalError")) return
    if (this.fastboot.isFastBoot) return
    if (action.attributes.sync.status === "persisted") return
    //  if (get(action, "attributes.sync.failureCount") > 5) return;

    // Filter out card-stack-summary patches from being sent
    let patches = _.reject(
      action.attributes.patches,
      (patch) => patch.document.modelType == "card-stack-summary"
    )
    action.attributes.patches = patches

    get(this, "actions").addObject(action)
    set(action.attributes.sync, "attemptCount", action.attributes.sync.attemptCount + 1)
    if (!action.attributes.narrative?.isQuiet) {
      console.log("📬 Action Publishing", action.attributes.name, action.id)
    }

    this._ensureChannelIsConnected()
    if (this.channel === undefined) return

    set(action.attributes.sync, "status", "in-flight")
    this.channel
      .push("new-action", action, 10000)
      .receive("ok", ({ unpersistedHistoricAction }) => {
        set(action.attributes.sync, "status", "persisted")
        get(this, "actions").removeObject(action)
        if (!action.attributes.narrative?.isQuiet) {
          console.log(
            `📪 Action #${action.attributes.order.amongPublishedClientActions} Published!`,
            action.attributes.name,
            action.id
          )
        }

        if (action.attributes.sync.isUserFacing) {
          set(this, "syncedUserFacingActionsCount", get(this, "syncedUserFacingActionsCount") + 1)
          get(this, "recentlyPublishedActions").pushObject(action)
        }

        // Keep it to 5 items. Not that reliable as we could have added more than one object.
        if (this.recentlyPublishedActions.length > 5) get(this, "recentlyPublishedActions").shift()

        if (unpersistedHistoricAction === true) {
          console.log("HISTORIC ACTION", action.attributes.name, action.id)
          let error = new Error(`HISTORIC ACTION Id: ${action.id}.`)
          notifySentry(error, action.id, false)
        }

        // if there are actions in the queue, we send the next action. Most likely, it will already have
        // been sent and thus will be set to `in-flight` and won't double send.
        if (this.actions.length > 0) {
          const nextAction = this.actions[0]
          if (nextAction.attributes.sync.status !== "in-flight") {
            this._publishNewAction(nextAction)
          }
        }
      })
      .receive("error", (refusal: JsonApiError | PhoenixChannelError) => {
        Sentry.setTag("actionId", action.id)
        console.log("😒 Action failed", action.attributes.name, action.id, refusal)
        // Handle refusal reason == unmatched topic.
        if ("reason" in refusal) {
          // The only error we handle is "unmatched topic". If we handle others, we need a type check
          this.reloadPage()
          return
        } else {
          // If we're getting an error from the server that hey, it just didn't broadcast
          if (refusal.code === "PUBSUB_BROADCAST_ERROR") {
            this._retryAction(action, refusal.code)
            return
            // just retry
          } else if (refusal.code === "DB_CONNECTION_ERROR") {
            this._retryAction(action, refusal.code)
            return
            // if we need a missing action
          } else if (refusal.code === "OUT_OF_ORDER") {
            this._retryAction(action, refusal.code)

            // HANDLE NACK
            // An alternative is to send over all actions with a higher count, but I think that would just lead to a higher load on the server
            forEach(
              filter(this.actions, (anAction): boolean => {
                return (
                  anAction.attributes.order.amongPublishedClientActions ===
                  refusal.meta?.actionNumberNeeded
                )
              }),
              (anAction) => this._publishNewAction(anAction)
            )
            // else, let's throw an error
          } else if (refusal.code === "CONFLICT") {
            this._failPermanently(action, refusal, refusal.code)
          } else {
            this._failPermanently(action, refusal, "OTHER")
          }
        }
      })
      .receive("timeout", () => {
        console.log("😒 Action timeout", action.attributes.name, action.id)
        set(action.attributes.sync, "status", "failed")
        set(action.attributes.sync, "failureReason", "timeout")
        set(
          action.attributes.sync,
          "retryAt",
          dateFns.addMilliseconds(
            new Date(),
            fibonacciBackoff(action.attributes.sync.attemptCount + 1, 500),
            60000
          )
        )
        console.log("Publish Action Timeout", ...arguments)
      })
  }

  _ensureChannelIsConnected() {
    if (this.channel && includes(["errored", "closed"], this.channel.state))
      this._connectToChannel()
  }

  /* ==============================================================
   * Other
   * ==============================================================
   */

  /**
   * We set this so that we know not to check for unsynced actions
   */
  beginRedirect() {
    this.isRedirectingAfterSignIn = true
  }

  /* ==============================================================
   * Private
   * ==============================================================
   */

  _retryAction(action: ActionDoc, reason: JsonApiErrorCodes | "OTHER") {
    let retryMilliseconds = fibonacciBackoff(action.attributes.sync.attemptCount + 1, 1000, 60000)
    set(action.attributes.sync, "status", "failed")

    set(action.attributes.sync, "failureReason", reason)
    set(action.attributes.sync, "retryAt", dateFns.addMilliseconds(new Date(), retryMilliseconds))
  }

  _failPermanently(action: ActionDoc, refusal, code) {
    let eventName = code === "CONFLICT" ? "Conflict Error" : "Server Error"
    if (window) {
      track(eventName, { errorId: refusal.id })
    }
    let failureCount = action.attributes.sync.failureCount || 0

    let error = new Error(`${eventName} Id: ${refusal.id}.`)

    Sentry.configureScope((scope) => {
      scope.setExtra("serverErrorId", refusal.id)
      scope.setExtra("refusal", refusal)
    })

    let id = refusal?.id || ObjectId.create()

    postError(error, id)
    notifySentry(error, id)

    set(action.attributes.sync, "status", "failed")
    set(action.attributes.sync, "failureReason", code)
    set(action.attributes.sync, "failureCount", failureCount + 1)

    let title =
      code === "CONFLICT"
        ? "The server just received two changes to the same thing at the same time."
        : "There's been a server error. We need to refresh your browser."

    let description =
      code === "CONFLICT"
        ? `Error code: ${code}:${refusal.id}`
        : `We've been notified. Error code: ${code}:${refusal.id}`

    swal({
      title: title,
      text: description,
      type: "warning",
      showCancelButton: false,
      allowOutsideClick: false,
      allowEscapeKey: false,
    })
      .then(() => window.location.reload())
      .catch(() => window.location.reload())

    set(this, "hasEncounteredFatalError", true)
  }

  _pollActionsTimer: EmberRunTimer | null = null
  _pollActions() {
    this._pollActionsTimer = later(() => {
      _.chain(get(this, "actions"))
        .filter((action) => {
          // if it's failed or it's been attempted once and it's over 15 seconds ago. This protects the case the channel
          // never times it out.
          return (
            action.attributes.sync.status === "failed" ||
            (action.attributes.attemptCount === 1 &&
              new Date().valueOf() - dateFns.parse(action.attributes.timing.clientSentAt) > 15000)
          )
        })
        .filter((action) => {
          if (get(this, "showBusySyncingModal")) {
            return true
          } else if (action.attributes.sync.retryAt) {
            return action.attributes.sync.retryAt <= new Date()
          } else {
            return true
          }
        })
        .sortBy("attributes.order.amongPublishedClientActions")
        .take(1)
        .forEach((action) => {
          this._publishNewAction(action)
        })
        .value()
      this._pollActions()
    }, 1000)
  }

  /**
   * Admin
   */
  adminReloadSession({ sessionId }) {
    return new Promise((resolve, reject) => {
      this._ensureChannelIsConnected()
      if (this.channel === undefined) return
      this.channel
        .push("admin-reload-session", { sessionId })
        .receive("ok", resolve)
        .receive("error", reject)
    })
  }
  adminReloadAllSessions({ userId }) {
    return new Promise((resolve, reject) => {
      this._ensureChannelIsConnected()
      if (this.channel === undefined) return
      this.channel
        .push("admin-reload-all-sessions", { userId })
        .receive("ok", resolve)
        .receive("error", reject)
    })
  }
  adminSignOutAllSessions({ userId }) {
    return new Promise((resolve, reject) => {
      this._ensureChannelIsConnected()
      if (this.channel === undefined) return
      this.channel
        .push("admin-sign-out-all-sessions", { userId })
        .receive("ok", resolve)
        .receive("error", reject)
    })
  }
}

// https://gist.github.com/kitcambridge/11101250
export function fibonacciBackoff(attempt: number, delay: number, maxWait = 10000): number {
  var current = 1

  if (attempt > current) {
    var prev = 1
    current = 2

    for (var index = 2; index < attempt; index++) {
      var next = prev + current
      prev = current
      current = next
    }
  }

  return Math.min(maxWait, Math.floor(current * delay))
}

// I think we get this from Phoenix, but I can't quite tell who is sending it.
// I think it's somewhere in the Phoenix Channel library
interface PhoenixChannelError {
  reason: string
}
