/**
 * Type-level prototype: verify Branded<T> works with real-world interfaces.
 *
 * No runtime behavior — this file only tests TypeScript compilation.
 * If it compiles, the types work. If it doesn't, we know what breaks.
 */

// ---------------------------------------------------------------------------
// The Branded type
// ---------------------------------------------------------------------------

declare const $BRAND: unique symbol

type Branded<T> =
  T extends Array<infer U>
    ? Array<Branded<U>>
    : T extends object
      ? { [K in keyof T]: Branded<T[K]> } & { readonly [$BRAND]: true }
      : T

// ---------------------------------------------------------------------------
// Real-world interfaces (from user's codebase)
// ---------------------------------------------------------------------------

type CardStackUsedAsTypes = 'lesson' | 'routine' | 'routine-template'

interface CardStackAttributes {
  title?: string | null
  subtitle?: string | null
  usedAs: CardStackUsedAsTypes
  cards: Array<Card>
  reviews: Array<Review>
  version: number
  parentCardStack?: null | ParentCardStack
  flags?: object
  commentIds: string[]
  versionNarrative?: object
  cachedDates?: Array<string>
  _revision: number
  _revisedBySessionId: string | null
  color?: string
}

interface LessonCardStackAttributes extends CardStackAttributes {
  cards: Array<LessonCard>
}

interface ParentCardStack {
  id: string
  version: number
  ownerIds: Array<string>
  courseId: string | null
  planbookId: string | null
}

interface Review {
  groupId: string
  cardStackId: string
  isRequested: boolean
  lastRequestedAt: null | string
  status: null | "REVISE_AND_RESUBMIT" | "APPROVED"
  lastStatusGivenAt: null | string
}

type Card =
  | CardCourseSlot
  | CardTitleValueHtml
  | CardValueHtml
  | CardStandards
  | CardGoogleClassroom

type LessonCard = CardTitleValueHtml | CardStandards | CardGoogleClassroom | CardValueHtml

interface CardTitleValueHtml {
  id: string
  type: "card-title-value-html"
  attributes: CardAttributesTitleValueHtml
}

interface CardValueHtml {
  id: string
  type: "card-value-html"
  attributes: CardAttributesValueHtml
}

interface CardGoogleClassroom {
  id: string
  type: "card-google-classroom"
  attributes: CardAttributesGoogleClassroom
}

interface CardCourseSlot {
  id: string
  type: "card-course-slot"
  attributes: CardAttributesCourseSlot
}

interface CardStandards {
  id: string
  type: "card-standards"
  attributes: CardAttributesStandards
}

type CardColorType =
  | "yellow" | "orange" | "red" | "magenta" | "purple"
  | "navy" | "blue" | "teal" | "green"

interface CardAttributesBase {
  position: number | null
  attachments: Array<CardAttachment>
  commentIds: Array<string>
  comments: Array<LegacyCardComment>
  color: CardColorType
  isPublic: boolean
  parentCardId: string | null
}

interface CardAttributesTitleValueHtml extends CardAttributesBase {
  title: string
  value: string
}

interface CardAttributesValueHtml extends CardAttributesBase {
  value: string
}

type GoogleClassroomPostType =
  | "ASSIGNMENT" | "ANNOUNCEMENT" | "MATERIAL"
  | "SHORT_ANSWER_QUESTION" | "MULTIPLE_CHOICE_QUESTION"

interface CardAttributesGoogleClassroom extends CardAttributesBase {
  postType: GoogleClassroomPostType
  title: string
  value: string
  maxPoints: string | null
  classSettings: Array<GoogleClassroomClassSetting>
  attachmentSettings: AttachmentSettingsObject
  extraPostProperties: {
    topicName?: string | null
    choices?: Array<string> | null
  }
  enabledGoogleClassIds: Array<string>
  _revision: number
}

interface AttachmentSettingsObject {
  [id: string]: { shareMode: ShareModeSettings }
}

type ShareModeSettings = "VIEW" | "EDIT" | "STUDENT_COPY"

type RelativeDueDate = "SAME_DAY" | "NEXT_DAY" | "END_OF_WEEK" | "END_OF_NEXT_WEEK"

interface GoogleClassroomClassSetting {
  googleClassId: string
  isEnabled: boolean
  scheduledAtTime: {
    hour: number
    minute: number
  }
  dueAt: null | {
    date: string | RelativeDueDate
    hour: number
    minute: number
  }
}

interface CardAttributesStandards extends CardAttributesBase {
  title: string
  standards: Array<CardStandard>
}

interface CardAttributesCourseSlot {
  courseId: string
  position: number | null
  parentCardId: string | null
}

interface CardStandard {
  id: string
  code: string
  statement: string
  jurisdiction: string
  grades: string
  standardSetId: string
  subject: string
  emphasisLevel: null | "STARRED" | "EXPANDED"
}

interface CardAttachment {
  id: string
  title: string
  url: string
  type: string
  mimetype: string
  size: number
  isWriteable: boolean
}

interface LegacyCardComment {
  id: string
  text: string
  commenterName: string
  commenterId: string
  createdAt: string
}

// ---------------------------------------------------------------------------
// Type assertion helpers
// ---------------------------------------------------------------------------

type AssertBranded<T> = T extends { readonly [$BRAND]: true } ? true : false
type Assert<T extends true> = T

// ---------------------------------------------------------------------------
// Tests: primitives unchanged
// ---------------------------------------------------------------------------

type _1 = Assert<Branded<string> extends string ? true : false>
type _2 = Assert<Branded<number> extends number ? true : false>
type _3 = Assert<Branded<boolean> extends boolean ? true : false>
type _4 = Assert<Branded<null> extends null ? true : false>
type _5 = Assert<Branded<undefined> extends undefined ? true : false>

// ---------------------------------------------------------------------------
// Tests: simple object branded
// ---------------------------------------------------------------------------

type _10 = Assert<AssertBranded<Branded<{ name: string }>>>
type _11 = Assert<Branded<{ name: string }>['name'] extends string ? true : false>

// ---------------------------------------------------------------------------
// Tests: nested object branded at all levels
// ---------------------------------------------------------------------------

type Nested = { a: { b: { c: number } } }
type _20 = Assert<AssertBranded<Branded<Nested>>>
type _21 = Assert<AssertBranded<Branded<Nested>['a']>>
type _22 = Assert<AssertBranded<Branded<Nested>['a']['b']>>
type _23 = Assert<Branded<Nested>['a']['b']['c'] extends number ? true : false>

// ---------------------------------------------------------------------------
// Tests: arrays — items branded, array itself branded
// ---------------------------------------------------------------------------

type _30 = Assert<AssertBranded<Branded<{ items: Array<{ id: string }> }>>>
// Arrays themselves are NOT branded — they're not store objects with $NODE.
// The proxy handles array access. Only array items are branded.
type _31 = Assert<AssertBranded<Branded<{ items: Array<{ id: string }> }>['items'][0]>>

// ---------------------------------------------------------------------------
// Tests: optional properties preserved
// ---------------------------------------------------------------------------

type OptionalTest = Branded<{ title?: string | null }>
type _40 = Assert<AssertBranded<OptionalTest>>
// title should still be optional
type _41 = Assert<undefined extends OptionalTest['title'] ? true : false>
type _42 = Assert<null extends OptionalTest['title'] ? true : false>

// ---------------------------------------------------------------------------
// Tests: discriminated unions — each variant branded
// ---------------------------------------------------------------------------

type BrandedCard = Branded<Card>
type _50 = Assert<AssertBranded<Extract<BrandedCard, { type: "card-standards" }>>>
type _51 = Assert<AssertBranded<Extract<BrandedCard, { type: "card-title-value-html" }>>>
type _52 = Assert<AssertBranded<Extract<BrandedCard, { type: "card-course-slot" }>>>

// narrowing: after checking type, attributes should be branded
type NarrowedStandards = Extract<BrandedCard, { type: "card-standards" }>
type _53 = Assert<AssertBranded<NarrowedStandards['attributes']>>

// ---------------------------------------------------------------------------
// Tests: index signatures
// ---------------------------------------------------------------------------

type BrandedAttachmentSettings = Branded<AttachmentSettingsObject>
type _60 = Assert<AssertBranded<BrandedAttachmentSettings>>
type _61 = Assert<AssertBranded<BrandedAttachmentSettings[string]>>

// ---------------------------------------------------------------------------
// Tests: the full CardStackAttributes
// ---------------------------------------------------------------------------

type BrandedCardStack = Branded<CardStackAttributes>
type _70 = Assert<AssertBranded<BrandedCardStack>>
// nested array items branded
type _71 = Assert<AssertBranded<BrandedCardStack['cards'][0]>>
type _72 = Assert<AssertBranded<BrandedCardStack['reviews'][0]>>
// deep nesting: card → attributes → attachments[0]
type _73 = Assert<AssertBranded<
  Extract<BrandedCardStack['cards'][0], { type: "card-title-value-html" }>['attributes']
>>
// optional nested object branded
type _74 = Assert<
  NonNullable<BrandedCardStack['parentCardStack']> extends { readonly [$BRAND]: true }
    ? true
    : false
>

// ---------------------------------------------------------------------------
// Tests: LessonCardStackAttributes (extends CardStackAttributes)
// ---------------------------------------------------------------------------

type BrandedLesson = Branded<LessonCardStackAttributes>
type _80 = Assert<AssertBranded<BrandedLesson>>
type _81 = Assert<AssertBranded<BrandedLesson['cards'][0]>>

// ---------------------------------------------------------------------------
// Tests: GoogleClassroom deep nesting
// ---------------------------------------------------------------------------

type BrandedGC = Branded<CardAttributesGoogleClassroom>
type _90 = Assert<AssertBranded<BrandedGC>>
type _91 = Assert<AssertBranded<BrandedGC['classSettings'][0]>>
type _92 = Assert<AssertBranded<BrandedGC['classSettings'][0]['scheduledAtTime']>>
type _93 = Assert<AssertBranded<BrandedGC['extraPostProperties']>>
type _94 = Assert<AssertBranded<BrandedGC['attachmentSettings']>>

// ---------------------------------------------------------------------------
// Tests: typeof store pattern (how users would extract types)
// ---------------------------------------------------------------------------

// Simulate createStore returning Branded<T>
declare function createStore<T extends object>(data: T): [Branded<T>, (ops: any) => void]

const [store] = createStore({
  organization: {
    id: 'org-1',
    name: 'TechCorp',
    departments: [
      {
        id: 'dept-1',
        name: 'Engineering',
        teams: [
          {
            id: 'team-1',
            name: 'Backend',
            members: [
              { id: 'emp-1', name: 'Alice', role: 'Dev', skills: ['Node.js'] },
            ],
          },
        ],
      },
    ],
  },
})

type Store = typeof store
type Dept = Store['organization']['departments'][0]
type Team = Dept['teams'][0]
type Member = Team['members'][0]

type _100 = Assert<AssertBranded<Store>>
type _101 = Assert<AssertBranded<Store['organization']>>
type _102 = Assert<AssertBranded<Dept>>
type _103 = Assert<AssertBranded<Team>>
type _104 = Assert<AssertBranded<Member>>
type _105 = Assert<Member['name'] extends string ? true : false>

// Component prop pattern: member is branded, plugin compiles reads
function MemberCard({ member }: { member: Member }) {
  // This would be compiled: readSignal(member, 'name')()
  return member.name
}
