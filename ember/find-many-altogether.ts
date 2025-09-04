import { inject as service } from "@ember/service"
import { tracked } from "@glimmer/tracking"
import { TypeToModel } from "cc-frontend/models/store"
import Store from "cc-frontend/services/store"
import { Resource } from "ember-could-get-used-to-this"
import { isEqual, isNil, map } from "lodash-es"
import { all } from "rsvp"

interface Args<TypeName> {
  positional: [type: TypeName, ids: Array<string> | null]
}

export default class FindManyAltogether<
  TypeName extends keyof TypeToModel,
  Type extends TypeToModel[TypeName]
> extends Resource<Args<TypeName>["positional"]> {
  // export default class FindManyAltogether extends Resource<Args["positional"]> {
  @service declare store: Store

  declare type: keyof TypeToModel | null
  declare ids: Array<string> | null

  @tracked isPending = false
  @tracked isSettled = false
  @tracked isRejected = false
  @tracked isFulfilled = false
  @tracked content: Array<Type> | null = null

  setup() {
    if (this.args.positional) {
      this.type = this.args.positional[0]
      let newIds = this.args.positional[1]
      this.ids = newIds ? newIds.slice() : null
    }
    this._find()
  }

  _find() {
    if (isNil(this.type) || isNil(this.ids)) return
    let type = this.type
    this.isPending = true
    this.isFulfilled = false
    this.isSettled = false
    all<Type>(map(this.ids, (id) => this.store.find(type, id)))
      .then((docs: Array<Type>) => {
        this.isPending = false
        this.isFulfilled = true
        this.content = docs
      })
      .catch(() => {
        this.isRejected = true
      })
      .finally(() => {
        this.isSettled = true
      })
  }

  update() {
    if (this.args.positional) {
      let newType = this.args.positional[0]
      let newIds = this.args.positional[1]
      // The entire query changes
      if (newType !== this.type || !isEqual(newIds, this.ids)) {
        this.type = newType
        this.ids = newIds ? newIds.slice() : null
        this._find()
      }
    }
  }

  teardown() {
    // we'll unsubscribe from it here.
  }
}
