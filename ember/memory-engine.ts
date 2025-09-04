import { A } from "@ember/array"
import { get, set, setProperties } from "@ember/object"
import { guidFor } from "@ember/object/internals"
import { begin, end } from "@ember/runloop"
import Service, { inject as service } from "@ember/service"
import { dasherize } from "@ember/string"
import { isNone } from "@ember/utils"
import { TypeToModel } from "cc-frontend/models/store"
import FastbootService from "ember-cli-fastboot/app/services/fastboot"
import {
  get as _get,
  cloneDeep,
  each,
  find,
  findIndex,
  first,
  fromPairs,
  isArray,
  isEqual,
  isMatch,
  isPlainObject,
  last,
  matches,
} from "lodash-es"
import { OpsDoc, PatchModel } from "../lib/patch-updater"

export default class MemoryEngine extends Service {
  // @ts-ignore
  @service("fastboot") fastboot!: FastbootService

  __store__: object = Object.create(null)
  __history: [] = []
  __redos: [] = []

  /**
   * Runs immediately when the service is created. Sets properties on the window to properties on the
   * memoryEngine service and makes sure they're empty. Binds the context of undo and redo to memoryEngine class
   *  Checks if it's fastboot, declares and sets shoebox variable to fastboot shoebox.
   *  Shoebox can improve performance time by reducing potentially duplicate server API calls - if calls/responses
   *  are already available via fastboot shoebox, the browser does not need to make these calls.
   *  The "my-store" object in shoebox is set to an empty object.
   */
  constructor(...args) {
    super(...args)
    // super(...arguments)
    // @ts-ignore
    window.__STORE__ = this.__store__
    // @ts-ignore
    window.__UNDO = this.undo.bind(this)
    // @ts-ignore
    window.__REDO = this.redo.bind(this)
    // @ts-ignore:
    window.__HISTORY = this.__history

    this.__store__ = Object.create(null)
    this.__history = []
    this.__redos = []

    // Init the shoebox store
    // @ts-ignore
    if (get(this, "fastboot.isFastBoot")) {
      // @ts-ignore
      let shoebox = get(this, "fastboot.shoebox")
      // @ts-ignore
      shoebox.put("my-store", {})
    }
  }

  get rawStore() {
    return this.__store__
  }

  /**
   * Resets/clears all instance properties
   *
   * @return undefined
   */
  reset() {
    set(this, "__store__", Object.create(null))
    set(this, "__history", [])
    set(this, "__redos", [])
  }

  // previously used in conjunction with redux store
  checkpoint() {
    // this.__history.push(_.cloneDeep(this.__store__))
  }

  /**
   * Previously used in conjunction with redux store
   * Removes last element from history property array and pushes it into the redos property array.
   * Calls applyUndo for that history object.
   */
  undo(): void {
    if (this.__history.length === 0) return
    let lastHistory = this.__history.pop()
    // @ts-ignore
    this.__redos.push(lastHistory)
    begin()
    console.time("applyUndo")
    this.applyUndo("", lastHistory)
    console.timeEnd("applyUndo")
    end()
  }

  /**
   * Previously used in conjunction with redux store
   * Removes last element from redos property array and pushes it into the history property array
   * Calls applyUndo for that history object
   */
  redo() {
    if (this.__redos.length === 0) return
    let lastUndo = this.__redos.pop()
    // @ts-ignore
    this.__history.push(lastUndo)
    begin()
    this.applyUndo("", lastUndo)
    end()
  }

  /**
   * Previously used in conjunction with redux store
   *
   * Checks the diff of the item (can be various data structures) in the store with what is being passed to it,
   * and then sets the store with the updated version
   * If the item is an object, it checks the value of the corresponding key,
   * If the item is an array, it repeats the process above, checking the first value in the array first as it was likely added most recently
   * If the item in the store is not the same as the value, we set it to be that way
   *
   * @param path [string] root path
   * @param hash [object]
   *
   * hash should be renamed to be the object we're comparing.
   */
  applyUndo(path, hash): void {
    each(hash, (value, key) => {
      // console.log(`${path}${key}`)
      if (isPlainObject(value)) {
        this.applyUndo(`${path}${key}.`, value)
        return
      }
      if (isArray(value) && value.length && isPlainObject(first(value))) {
        each(value, (val, index) => {
          this.applyUndo(`${path}${key}.${index}.`, val)
        })
        return
      }
      // @ts-ignore
      if (!isEqual(get(this.__store__, `${path}${key}`), value)) {
        // @ts-ignore
        console.log("setting value", `${path}${key}`, get(this.__store__, `${path}${key}`), value)
        // @ts-ignore
        set(this.__store__, `${path}${key}`, value)
      }
    })
  }

  /**
   * This is called from the store to check if the patch in the argument is in memoryEngine's local memory.
   * Makes sure patch exists and has right info. Checks store instance property to see if a model
   * type exists, if not, make one and set it to an empty object. If there's no model type in the store that has
   * the patch document id, set that to the id and set the attributes portion of the patch to {}, apply it to the match model and up the
   * internal version
   *
   * @param  patch PatchModel - references model type, id, actionId
   * @returns A function that rewinds the patch (updating our store's model in-place), assuming
   * that the model is in its exact state after applying the patch.
   */
  patch(patch: PatchModel) {
    if (patch === undefined)
      throw Error(
        "The patch function received undefined. Likely, this is because you didn't return the patch from the patch function."
      )
    let id = patch.document.id

    if (isNone(id) || id === "") {
      console.error("Erroneous Patch", patch)
      throw Error("No ID given. Cannot process.")
    }

    // @ts-ignore
    if (isNone(get(this, `__store__.${patch.document.modelType}`))) {
      // @ts-ignore
      set(this, `__store__.${patch.document.modelType}`, {})
    }

    // @ts-ignore
    if (isNone(get(this, `__store__.${patch.document.modelType}.${patch.document.id}`))) {
      // @ts-ignore
      set(this, `__store__.${patch.document.modelType}.${patch.document.id}`, {
        type: patch.document.modelType,
        id: patch.document.id,
        attributes: {},
        meta: {},
      })
    }

    const rewinds: (() => void)[] = []

    // checks embedded document path, if there isn't one, set it to an Ember native array
    if (patch.embeddedDocument && patch.embeddedDocument.path) {
      let model
      if (
        isNone(
          get(
            this,
            // @ts-ignore
            `__store__.${patch.document.modelType}.${patch.document.id}.${patch.embeddedDocument.path}`
          )
        )
      ) {
        set(
          this,
          // @ts-ignore
          `__store__.${patch.document.modelType}.${patch.document.id}.${patch.embeddedDocument.path}`,
          A([])
        )
      }
      let array: Array<any> = get(
        this.__store__,
        // @ts-ignore
        `${patch.document.modelType}.${patch.document.id}.${patch.embeddedDocument.path}`
      )
      model = find(array, patch.embeddedDocument.elemMatch)
      // model = _.find(array, el => el[embeddedMatchKey] === embeddedMatchValue)
      // Not sure about this but I think it's right
      // if there's no model push the elemMatch into the native array/embeddedDoc path
      if (isNone(model)) {
        rewinds.push(() => array.popObject())
        array.pushObject(cloneDeep(patch.embeddedDocument.elemMatch))
        model = last(array)
      }
      rewinds.push(applyPatchToModel(model, patch.embeddedDocument.ops))
    }
    // @ts-ignore
    let model = get(this, `__store__.${patch.document.modelType}.${patch.document.id}`) as Record<
      string,
      any
    >
    rewinds.push(applyPatchToModel(model, patch.document.ops))
    set(model, "internalVersion", (get(model, "internalVersion") || 0) + 1)
    // model.internalVersion++

    rewinds.reverse()
    return () => rewinds.forEach((rewind) => rewind())
  }

  /**
   * Keeps local memoryEngine storage current by adding previously unavailable models retrieved through fetch calls
   * or updating existing models with new updates from the server.
   * Check local store for model of document type, make an empty object if it doesn't exist,
   * declare exisitingDoc variable in local store with document type and id, redeclare fastboot shoebox and retrieve
   * document object that was passed in. No exisitingDocument?, make a new document in the local store
   * @param  doc [object] - document object
   * @return     [object] - updated (or new) document object
   */
  insert(doc) {
    if (get(this, "isDestroyed") || get(this, "isDestroying")) return

    // If we're inserting nothing, return nothing
    if (doc === undefined) return null

    // Make sure we have a hash for this type of model
    if (isNone(this.__store__[doc.type])) this.__store__[doc.type] = Object.create(null)

    // get the document
    // @ts-ignore
    let existingDoc = get(this, `__store__.${doc.type}.${doc.id}`)

    // Store in fastboot
    // @ts-ignore
    if (get(this, "fastboot.isFastBoot")) {
      // @ts-ignore
      let shoebox = get(this, "fastboot.shoebox")
      // @ts-ignore
      shoebox.retrieve("my-store")[`${doc.type}.${doc.id}`] = doc
    }

    function deepFreeze(object) {
      // Retrieve the property names defined on object
      var propNames = Object.getOwnPropertyNames(object)

      // Freeze properties before freezing self

      for (let name of propNames) {
        let value = object[name]

        if (value && typeof value === "object") {
          deepFreeze(value)
        }
      }

      return Object.freeze(object)
    }

    // If there is an existing doc, update it with the fresh data from the server
    if (existingDoc !== undefined && existingDoc !== null) {
      setProperties(existingDoc, doc)
      // @ts-ignore
      let existingInternalVersion = existingDoc?.internalVersion || 0
      // @ts-ignore
      set(existingDoc, "internalVersion", existingInternalVersion + 1)
      return existingDoc

      // if there isn't an existing doc and we actually are dealing with a doc, add it to teh Store
      // and then return it
    } else if (doc && doc.type && doc.id) {
      // Probably not necessary but can make debugging easier to see if
      // it's the same object. This can probably be taken out.
      guidFor(doc)
      guidFor(doc.attributes)
      // Set an internal version for tracking
      doc.internalVersion = 0
      // @ts-ignore
      set(this, `__store__.${doc.type}.${doc.id}`, doc)
      return doc
    }
  }

  /**
   * Makes sure requested item is in local memory and shoebox.  Will contact the server
   * using memoryEngine.insert() if local memory and shoebox don't have the requested item.
   * Declares shoebox variable as fastboot shoebox, checks dasherized model/id in memoryEngine and dasherized model/id in shoebox store.
   * No shoebox doc? Return the one from the store.
   * No localDoc but have shoebox doc? Insert that shoebox doc into the local store
   */
  find<ModelName extends keyof TypeToModel>(
    modelName: ModelName,
    id: string
  ): TypeToModel[ModelName] {
    // if (modelName === undefined) debugger;
    // @ts-ignore
    let shoebox = get(this, "fastboot.shoebox")
    // @ts-ignore
    let shoeboxStore = shoebox.retrieve("my-store") || {}
    // @ts-ignore
    let localDoc = get(this, `__store__.${dasherize(modelName)}.${id}`)
    let shoeboxedDoc = shoeboxStore[`${dasherize(modelName)}.${id}`]

    // If we found it in the shoebox, we need it to our memory store
    if (shoeboxedDoc === undefined) {
      // @ts-ignore
      return get(this, `__store__.${dasherize(modelName)}.${id}`)
    } else if (shoeboxedDoc && localDoc === undefined) {
      return this.insert(shoeboxedDoc)
    } else {
      // @ts-ignore
      return get(this, `__store__.${dasherize(modelName)}.${id}`)
    }
  }
}

/**
 * @returns A function that rewinds the patch (updating model in-place), assuming
 * that model is in its exact state after applying the patch.
 */
export function applyPatchToModel(model: Record<string, any>, ops: OpsDoc): () => void {
  const rewinds: (() => void)[] = []

  // Bizarrely, putting this on one line BREAKS. I have no earthly clue why.
  each(fromPairs(ops["set"]), (value, key) => {
    ensurePath(model, key)
    const previousValue = get(model, key)
    rewinds.push(() => set(model, key, previousValue))
    // The reason we need to clone this is so that other patch don't modify the value
    // coming from the patch. E.g.
    // - Patch 1 sets "val" to [1, 2, 3]
    // - Patch 2 pushes 4 into "val"
    // - Patch 1 will have it's "val" set to [1,2,3,4]
    // Thus, by cloning we keep the patch's values not affected
    set(model, key, cloneDeep(value))
  })
  each(fromPairs(ops["unset"]), (_value, key) => {
    const previousValue = get(model, key)
    rewinds.push(() => set(model, key, previousValue))
    set(model, key, undefined)
  })
  each(fromPairs(ops["inc"]), (value, key) => {
    // @ts-ignore
    ensurePath(model, key, null)
    const previousValue = get(model, key)
    rewinds.push(() => set(model, key, previousValue))
    set(model, key, (previousValue || 0) + value)
  })
  each(fromPairs(ops["push"]), (value, key) => {
    ensurePath(model, key, A([]))

    // push each
    if (isArray(value) && value[0] === "$each") {
      each(value[1], (val) => {
        rewinds.push(() => get(model, key).popObject())
        get(model, key).pushObject(cloneDeep(val))
      })

      // push one
    } else {
      if (isArray(get(model, key)) !== true) {
        set(model, key, [])
      }
      rewinds.push(() => get(model, key).popObject())
      get(model, key).pushObject(cloneDeep(value))
    }
  })

  each(fromPairs(ops["pull"]), (value, key) => {
    ensurePath(model, key, [])
    let array = get(model, key)

    // We compare properties or identities depending on what it is.
    let index = findIndex(array, (el) => {
      if (value && isArray(value) && first(value) === "$_dottedPath_") {
        return _get(el, value[1]) === value[2]
      } else {
        // @ts-ignore
        return isPlainObject(el) ? isMatch(el, value) : isEqual(el, value)
      }
    })

    if (index > -1) {
      const previousValue = get(model, key)[index]
      rewinds.push(() => get(model, key).insertAt(index, previousValue))
      get(model, key).removeAt(index, 1)
    }
  })

  each(fromPairs(ops["pullAll"]), (values, key) => {
    ensurePath(model, key, [])
    let array = get(model, key)

    // We compare properties or identities depending on what it is.
    each(values, (value) => {
      let index = findIndex(array, (el) => {
        return isPlainObject(el) ? matches(value)(el) : isEqual(el, value)
      })

      if (index > -1) {
        const previousValue = get(model, key)[index]
        rewinds.push(() => get(model, key).insertAt(index, previousValue))
        get(model, key).removeAt(index, 1)
      }
    })
  })

  each(fromPairs(ops["addToSet"]), (value, key) => {
    ensurePath(model, key, A([]))
    let valsToAdd = isArray(value) && value[0] === "$each" ? value[1] : [value]
    each(valsToAdd, (val) => {
      let doesNotContainVal = find(get(model, key), (obj) => isEqual(obj, val)) === undefined
      if (doesNotContainVal) {
        // Since the array does not contain the value, addObject pushes it onto the end ==> rewind with popObject.
        rewinds.push(() => get(model, key).popObject())
        get(model, key).addObject(cloneDeep(val))
      }
    })
  })

  rewinds.reverse()
  return () => rewinds.forEach((rewind) => rewind())
}

// this is a bit messy but if we have a nested path (e.g.
// attributes.clipboard.sections), all the paths are a map if they're
// undefined or null. Should probably be pulled out, rewritten, and used
// in the unset, inc, and push commands.
function ensurePath(object: object, path: string, lastType = {}): void {
  if (_get(object, path) === undefined) {
    let paths = path.split(".")
    let acc = []
    each(paths, (part) => {
      // @ts-ignore
      acc.push(part)
      if (isNone(_get(object, acc.join(".")))) {
        acc.length === paths.length
          ? // prettier-ignore
            // @ts-ignore
            set(object, acc.join("."), lastType)
          : // prettier-ignore
            // @ts-ignore
            set(object, acc.join("."), {})
      }
    })
  }
}

declare module "@ember/service" {
  interface Registry {
    memoryEngine: MemoryEngine
  }
}
