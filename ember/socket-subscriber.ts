import { get, set } from "@ember/object"
import { cancel, later } from "@ember/runloop"
import Service, { inject as service } from "@ember/service"
import { isNone } from "@ember/utils"
import { handleError } from "cc-frontend/app"
import compareVersions from "compare-versions"
import _ from "lodash"
import ENV from "../config/environment"
import Dialog from "./dialog"
import Session from "./session"
import SocketService from "./socket"
import Store from "./store"

export default class SocketSubscriber extends Service {
  @service declare socket: SocketService

  @service declare session: Session

  @service declare store: Store

  @service declare dialog: Dialog

  lastSuccessfulPing = new Date()

  serverVersion = null
  serverHostname = null
  serverRelease = null

  heartbeat() {
    // Refresh the page if it's been more than 1 day since the last successful ping.
    let secondsSinceLastSuccessfulPing = Math.floor(
      (new Date().valueOf() - this.lastSuccessfulPing.valueOf()) / 1000
    )

    // 1 day
    if (secondsSinceLastSuccessfulPing > 86400) {
      console.log("Session has expired. Reloading page...")
      this.socket.reloadPage()
    }
    if (this.socket.subscriptions.length > 2) {
      this.socket.pushHeartbeat((data) => {
        this.lastSuccessfulPing = new Date()
        this.socket.recordConnectedStatus()

        /**
         * Log the server version, host, and release
         * This helps us know when a server release actually activates
         *
         * Check if it's null so we don't log it the first time.
         */
        if (data.serverVersion !== this.serverVersion) {
          if (this.serverVersion !== null) {
            console.log(`Syncing server is at release: ${data.serverVersion}`)
          }
          this.serverVersion = data.serverVersion
        }
        if (data.hostname !== this.serverHostname) {
          if (this.serverHostname !== null) {
            console.log(`Connected to new syncing server: ${data.hostname}`)
          }
          this.serverHostname = data.hostname
        }
        if (data.release !== this.serverRelease) {
          if (this.serverRelease !== null) {
            console.log(`Syncing server was upgraded to: ${data.release}`)
          }
          this.serverRelease = data.release
        }

        if (data.lastSequenceNumberSent > this.lastSequenceNumberReceived) {
          this._requestLostSequence(this.lastSequenceNumberReceived + 1)
        } else {
          let date = new Date()
          console.log(
            `Sync Complete. Page is ${document.visibilityState}. Update #${
              data.lastSequenceNumberSent
            } received. (${date.toISOString()} - ${this.session.id})`
          )
        }
        let minimumVersion = data.clientVersion.replace("Cc.", "")
        if (compareVersions.compare(ENV.CLIENT_VERSION, minimumVersion, "<")) {
          console.log(
            `Must update to new version. We have ${ENV.CLIENT_VERSION} and we need to refresh to have: ${data.clientVersion}`
          )
          setTimeout(() => {
            this.showReloadOnNewVersionNotice()
          }, Math.random() * 10000)
          setTimeout(function () {
            window.location.reload()
          }, 300000 + Math.random() * 300000)
        }
      })
    }
  }

  _heartbeatLooperTimer: ReturnType<typeof later> | null = null

  heartbeatLoop() {
    this._heartbeatLooperTimer = later(() => {
      this.heartbeatLoop()
      this.heartbeat()
    }, 22000)
  }

  willDestroy() {
    if (this._heartbeatLooperTimer) cancel(this._heartbeatLooperTimer)
    super.willDestroy()
  }

  showReloadOnNewVersionNotice() {
    if (this.session.userId) {
      get(this, "dialog")
        .blank("dialogs/alert-reload-on-new-version", {
          className: "dialog--create-annotation",
        })
        .then(() => {
          window.location.reload()
        })
        .catch((error) => {
          window.location.reload()
          if (error instanceof Error) handleError(error)
        })
    }
  }

  onModelUpdate(response, outOfSequencePatch?: boolean) {
    // Find if we're missing a patch => requestMissingUpdate
    // Find out if the server forgot to give us a patch => requestPatchForModel
    // Find out if we need to just update the version
    // Find out if we need to apply the patch
    let patches = _.isArray(response.data) ? response.data : [response.data]
    _.chain(patches)
      .map((patch) => this._checkSequenceNumber(patch, outOfSequencePatch))
      .compact()
      .forEach((patch) => this._processNewPatch(patch))
      .value()
  }

  _checkSequenceNumber(patch, outOfSequencePatch?: boolean) {
    // If it's the product of requesting a revision, then, we don't
    // care about it's order in the sequence.
    if (outOfSequencePatch === true) {
      return patch
    } else {
      // Expected patch
      if (patch.meta.sequenceNumber === this.lastSequenceNumberReceived + 1) {
        this.lastSequenceNumberReceived = patch.meta.sequenceNumber
        return patch
      }

      // A historial patch
      if (patch.meta.sequenceNumber <= this.lastSequenceNumberReceived) {
        return null
      }

      // A patch in the future
      if (patch.meta.sequenceNumber > this.lastSequenceNumberReceived + 1) {
        this._requestLostSequence(this.lastSequenceNumberReceived + 1)
        return null
      }
    }
  }

  lastSequenceNumberReceived = 0

  _processNewPatch(patch) {
    // For testing
    // if (Math.random() > 0.8) return;

    // Accept if:
    // the patch receieved if: the version produced is one more than our version. Otherwise, we're missing a patch.
    let currentModel = get(this, "store").findInMemory(
      patch.attributes.document.modelType,
      patch.attributes.document.id
    )
    if (isNone(currentModel)) return
    let weHaveRevision = get(currentModel, "attributes._revision") || 0
    let revisionAfterPatch = patch.attributes.revisionAfterServerApplication
    // console.log('patch', currentModel.type, patch, currentModel.attributes._revision)
    if (weHaveRevision + 1 === revisionAfterPatch) {
      this._acceptPatch(patch, currentModel)
      return
    }

    // A historical patch we've already applied
    if (weHaveRevision >= revisionAfterPatch) {
      return
    }

    // Request a missing patch
    if (weHaveRevision < revisionAfterPatch) {
      // This is hacky -- if we have a fake lesson that we're fillin in from the template. don't request it as it doesn't exist.
      if (weHaveRevision === 0 && patch.attributes.document.modelType === "card-stack") return
      this.requestRevision(
        patch.attributes.document.modelType,
        patch.attributes.document.id,
        weHaveRevision
      )
      return
    }
  }

  _acceptPatch(patch, currentModel) {
    if (this.session.user?.content?.attributes?.featureFlags["SERVER_RECONCILIATION"]) {
      this.store.applyPatchWithServerReconciliation(patch.attributes, patch.id, patch.type)
    } else {
      if (patch.type !== "patch-summary") {
        get(this, "store").applyForeignPatchToStore(patch.attributes)
      }
    }
    set(currentModel, "attributes._revision", patch.attributes.revisionAfterServerApplication)
    set(currentModel, "meta.lastUpdateFromServer", new Date())
  }

  _requestedRevisions: string[] = []

  requestRevision(modelName, id, revision) {
    let identifier = `${modelName}:${id}:${revision}`
    if (_.includes(this._requestedRevisions, identifier)) return
    this._requestedRevisions.push(identifier)
    if (!this.socket.channel) return
    console.log("requesting", identifier)
    this.socket.channel
      .push("request-revision", {
        modelType: modelName,
        id: id,
        revision: revision,
      })
      .receive("ok", (response) => {
        this.onModelUpdate(response, true)
        _.pull(this._requestedRevisions, identifier)
      })
      .receive("error", (response) => {
        _.pull(this._requestedRevisions, identifier)
      })
      .receive("timeout", (response) => {
        _.pull(this._requestedRevisions, identifier)
      })
  }

  _requestedSequenceNumbers: number[] = []

  _requestLostSequence(sequenceNumber) {
    if (_.includes(this._requestedSequenceNumbers, sequenceNumber)) return
    this._requestedSequenceNumbers.push(sequenceNumber)
    if (!this.socket.channel) return
    console.log("requesting lost sequence", sequenceNumber)
    this.socket.channel
      .push("request-lost-patch", { sequenceNumber: sequenceNumber })
      .receive("ok", (response) => {
        console.log("received lost sequence", sequenceNumber, response)
        this.onModelUpdate(response)
        _.pull(this._requestedSequenceNumbers, sequenceNumber)
        if (_.isArray(response.data) && response.data.length > 0) {
          this.heartbeat()
        }
      })
      .receive("error", (response) => {
        _.pull(this._requestedSequenceNumbers, sequenceNumber)
      })
      .receive("timeout", (response) => {
        _.pull(this._requestedSequenceNumbers, sequenceNumber)
      })
  }
}
