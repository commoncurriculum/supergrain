import Component from "@glimmer/component"
import FindDoc from "cc-frontend/helpers/find-doc"
import { ActionSummary } from "cc-frontend/models/action"
import { use } from "ember-could-get-used-to-this"

interface Sig {
  Args: {
    actionId: string
  }
  Blocks: {
    default: [model: FindDoc<"action-summary", ActionSummary>]
  }
}

export default class ActionSummaryProviderComponent extends Component<Sig> {
  @use model = new FindDoc(() => ["action-summary", this.args.actionId])
}

declare module "@glint/environment-ember-loose/registry" {
  export default interface Registry {
    ActionSummaryProviderComponent: typeof ActionSummaryProviderComponent
  }
}
