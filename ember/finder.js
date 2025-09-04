import { getOwner } from "@ember/application"
import { isArray } from "@ember/array"
import { get, set } from "@ember/object"
import { begin, end, later, cancel } from "@ember/runloop"
import Service, { inject as service } from "@ember/service"
import { dasherize } from "@ember/string"
import { isNone } from "@ember/utils"
import _ from "lodash"
import { Promise, resolve } from "rsvp"
import ENV from "../config/environment"

export default class Finder extends Service {
  @service fastboot

  @service store

  inFlightRequests = []
  requestedModels = []
  _processRequestTimer = null

  /**
   *  Runs immediately when the service is called. Sets params.
   *  Invokes _processRequests many times a second until finder service is torn down/destroyed
   */
  constructor() {
    super(...arguments)

    if (ENV.environment === "test") return
    let interval = () => {
      this._processRequestTimer = later(() => {
        this._processRequests()
        interval()
      }, 15)
    }
    interval()
  }

  willDestroy() {
    if (this._processRequestTimer) cancel(this._processRequestTimer)
    super.willDestroy(...arguments)
  }

  /**
   * Queues/stores requested models from BE in an array that is being constantly checked.
   * Requests are made to BE based on the models in the array by _processRequests()
   *
   * @param  {String} modelName
   * @param  {String} id
   * @param  {Number} failureCount=0
   * @return {Promise}  Waiting for document to be returned/resolved from BE
   */
  find(modelName, id, failureCount = 0) {
    if (id === null || id === undefined) {
      return resolve(null)
    }
    let promise = new Promise((resolve, reject) => {
      let startTime = new Date()
      this.requestedModels.push({
        resolve,
        reject,
        modelName,
        id,
        startTime,
        failureCount,
      })
    })
    if (get(this, "fastboot.isFastBoot")) {
      get(this, "fastboot").deferRendering(promise)
    }
    return promise
  }

  _processRequests() {
    if (get(this, "isDestroying") || get(this, "isDestroyed")) return

    // Grab the documents we're already requesting
    let inFlightRequestedDocuments = _.chain(this.inFlightRequests)
      .groupBy("modelName")
      .reduce((acc, array, modelName) => {
        acc[modelName] = _.map(array, "id")
        return acc
      }, {})
      .value()

    // Grab the models we'll be working with
    let requestedModels = get(this, "requestedModels")

    // Push the requested models into the inFlight array
    this.inFlightRequests = _.concat(get(this, "inFlightRequests"), requestedModels)

    // Empty the requestedModels
    set(this, "requestedModels", [])

    // Loop through the requested models and reject any that we're already inFlight
    _.chain(requestedModels)
      .groupBy("modelName")
      .each((array, modelName) => {
        _.chain(array)
          .map("id")
          .uniq()
          .reject((id) => _.includes(inFlightRequestedDocuments[modelName], id))
          .compact()
          .chunk(60)
          .forEach((ids) => {
            let adapter = getOwner(this).lookup(`adapter:${dasherize(modelName)}`)
            if (adapter === undefined) throw Error("Missing Adapter for " + modelName)
            adapter
              .find(ids)
              .then(([status, response]) => {
                if (status === "ok") {
                  return this.insertResponseDocs(response, modelName, ids)
                } else if (status === "error") {
                  this._handlePromises("reject", modelName, ids, response)
                }
              })
              .catch((response) => {
                console.log(response)
                // console.log('response', response.stack)
                // console.error("Ajax Error", arguments);
                this._handlePromises("reject", modelName, ids, response)
              })
          })
          .value()
      })
      .value()
  }

  /**
   * Inserts each returned document into the memoryEngine store. ModelName and id is sent to _handlePromise()
   * to check status of promise
   *
   * @param  {promise} response  Promise object from find() - see above
   * @param  {String} modelName
   * @param  {String} ids
   * @return {undefined}
   */
  insertResponseDocs(response, modelName, ids) {
    begin()
    let data = isArray(response.data) ? response.data : [response.data]
    data = _.reject(data, (datum) => datum === null)
    if (!isNone(response.included)) data = data.concat(response.included)
    _.forEach(data, (datum) => get(this, "store").insertDocument(datum))
    _.forEach(ids, (id) => this._handlePromise(modelName, id))
    end()
  }

  /**
   * Filters through inFLightRequests to find matching model. Resolves pending promises and finds them in memoryEngine.
   * Puts models that don't match the requested name and id back in inFlightRequests array
   * inFlightRequests array to be tried again
   *
   * @param  {[type]} modelName [description]
   * @param  {[type]} id        [description]
   * @return {[type]}           [description]
   */
  _handlePromise(modelName, id) {
    if (get(this, "isDestroying") || get(this, "isDestroyed")) return

    _.chain(get(this, "inFlightRequests"))
      .filter({ modelName: modelName, id: id })
      .filter((req) => req.resolve !== null && req.reject !== null)
      .each((req) => {
        // console.log("Request Time", new Date() - req.startTime)
        req.resolve(get(this, "store").findInMemory(req.modelName, req.id))
      })
      .value()

    let ifr = _.reject(get(this, "inFlightRequests"), {
      modelName: modelName,
      id: id,
    })
    set(this, "inFlightRequests", ifr)
  }

  _handlePromises(type, modelName, ids, response) {
    if (get(this, "isDestroying") || get(this, "isDestroyed")) return

    // Process our requests
    _(get(this, "inFlightRequests"))
      .filter((req) => req.modelName === modelName && _.includes(ids, req.id))
      .filter((req) => req.resolve !== null && req.reject !== null)
      .each((req) => {
        // console.log("Request Time", new Date() - req.startTime)
        if (type === "resolve") {
          req.resolve(get(this, "store").findInMemory(req.modelName, req.id))
        } else {
          let timeout = [1000, 2000, 5000, 10000, 20000, 30000][req.failureCount] || 60000
          later(() => {
            req.resolve(this.find(req.modelName, req.id, req.failureCount + 1))
          }, timeout)
        }
        let ifr = _.reject(get(this, "inFlightRequests"), {
          modelName: req.modelName,
          id: req.id,
        })
        set(this, "inFlightRequests", ifr)
      })
  }
}
