import { inject as service } from "@ember/service"
import { tracked } from "@glimmer/tracking"
import { TypeToModel } from "cc-frontend/models/store"
import Store from "cc-frontend/services/store"
import { Resource } from "ember-could-get-used-to-this"
import { isNil } from "lodash-es"

interface Args<T> {
  positional: [type: T, id: string | null | undefined, forceRefresh?: boolean]
}

export default class FindDoc<
  TypeName extends keyof TypeToModel,
  Type extends TypeToModel[TypeName]
> extends Resource<Args<TypeName>["positional"]> {
  @service declare store: Store

  declare type: keyof TypeToModel | null
  declare id: string | null | undefined
  forceRefresh: boolean = false

  @tracked isPending = false
  @tracked isSettled = false
  @tracked isRejected = false
  @tracked isFulfilled = false
  @tracked content: Type | null = null

  setup() {
    if (this.args.positional) {
      this.type = this.args.positional[0]
      this.id = this.args.positional[1]
      this.forceRefresh = this.args.positional[2] || false
    }
    this._find()
  }

  _find() {
    if (isNil(this.type) || isNil(this.id)) return
    this.isPending = true
    this.isFulfilled = false
    this.isSettled = false
    this.store
      .find(this.type, this.id, this.forceRefresh)
      .then((doc: Type) => {
        this.isPending = false
        this.isFulfilled = true
        this.content = doc
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
      let newId = this.args.positional[1]
      if (newType !== this.type || newId !== this.id) {
        this.type = newType
        this.id = newId
        this._find()
      }
    }
  }

  teardown() {
    // we'll unsubscribe from it here.
  }
}
