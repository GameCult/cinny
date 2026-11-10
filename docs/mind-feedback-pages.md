# Mind feedback pages

Design only. No code exists for this; nothing here is built. Drafted by Kiko Self (2026-11-07) with Heimdall's draft rulings
on guests and hiding; placement ruled for this repo by Void. Follow-up `eureka-body:follow_up:ratatoskr-mind-feedback-pages`.
Every number below is provisional.

**Schema owner.** The Huginn kinds, their fields, keys and refusals are specified in `huginn-feedback-kinds-proposal.md` (Eureka Self, 2026-11-07, in
`/opt/commons/handoff`), adopted for this page by Void's Persona. Where this page names a field of those kinds it mirrors that proposal; if they differ, the proposal wins.
This repo owns only the client: a typed interface mirroring those shapes, and fixtures.

Each Mind's section in the estate navigator opens on that Mind's **feedback page**: the Mind's open questions with options, its
recommendation and what each waits on, answerable by the operator and anyone with an account. It replaces the old Fork Desk
(taken from the brief; no trace of it was found in this repo or in the Minds' state).

## 1. Placement

Each Mind's navigator section **opens on its feedback page**, rooms below it. A cross-Mind list of everything waiting on a person
is wanted later and is not part of this spec. On phones the page folds each question's options and the answer form behind its title,
so the section root stays a list of questions, not a wall of forms.

## 2. Authority

| Concern | Owner | The page's part |
|---|---|---|
| The question | a typed `question` document in the **owning Mind's own mind**, key `<campaign>:question:<label>` | a view of it; the page stores and edits nothing |
| Which questions appear | the owning Mind, by a `feedback_listing` (the opt-in act) carrying `audience` and `close_grants`; un-listing is a `Withdrawn` resolution on it | shows only what has a listing in force |
| An answer | its author. The **receiver (Bifrost) holds the text**; the Mind holds a **text-free `feedback_answer` record** | submits the answer to the receiver |
| The ruling | the owning Mind, recorded by her | **never writes one**; links to it once she has |
| Status (open, answered, closed) | derived in the Mind from its documents (`closed` is a `Withdrawn` resolution on the question), never written | shows it |
| Who answered, and as what | the Bifrost account behind the Heimdall session, plus its role at the moment of the answer | shows it; never takes it from the client |
| Close | a `feedback_close_request` the owning Mind honours or declines; it never changes the question's status by itself | offers Close only to a grant holder; **the page writes no ruling** |
| Hiding | the owning Mind alone, as a `feedback_hide`; unhide is a `Withdrawn` resolution on it | shows the labelled stub; hides nothing itself |
| Erase | Bifrost's erase of an account; the receiver drops the text | shows "erased account" |

An answer is input to a Mind, not a vote and not a decision. **The page never tallies**: no counts, no totals, no "leading" option, no
ordering by popularity, no count of reports or close requests. Only the Mind's ruling picks anything.

## 3. Receiver and carriers

- **Schema owner: `huginn-feedback-kinds-proposal.md`.** Four new Huginn kinds, all Eureka's: `feedback_listing` (audience, `close_grants` with no Guest
  grant, the opt-in act), `feedback_answer` (a text-free record), `feedback_close_request` and `feedback_hide`. Unhide, un-list and "request declined"
  are `resolution`s on those kinds. This page proposes no kinds.
- **Bifrost is the receiver** (Heimdall's side). It verifies the Heimdall session, reads the account, stamps `answerer`, `kind`, weight and `time`,
  **stores the answer text**, delivers it, serves the projection the page reads, and **does the erase**. A Matrix sender is a different
  identity authority and never becomes `answerer`.
- **Huginn is RUDP-only.** The client never talks to Huginn, and the receiver never writes to it: an admission declared for another instance is refused
  (`ForeignInstance`), so a receiver "admitting as Kiko" would be unauthenticated by construction.
- **Delivery is by mouth.** The receiver delivers each answer or close request to the owning Mind's Persona through the mouth's pending/ack path (a new
  delivery document, `gamecult.persona.feedback_delivery.v1`, owned by Bifrost). **The Persona admits the text-free record into her own mind** and acks only
  after it is admitted; a restart redelivers the same record id, which is `AlreadyAdmitted`. The text reaches her turn once, in the delivery, and is never
  admitted.
- Dependencies that must ship first, in the proposal's order: Huginn readers (daemon, CLI, clients), then the Persona organ, then Bifrost's receiver.

## 4. Mock

```
Kiko  >  Feedback                                                    [synced 2 min ago]
--------------------------------------------------------------------------------------
Open questions                                         [ Open ]  [ Settled ]

OPEN | asked 6 Nov 2026 09:12 | waiting 1 day
Which source feeds audio_spectrum?                                    [ Details v ]
The visualizer contract assumes a host-side spectrum ... (3 lines, then "Show more")
Waits on:  "Overlay-wide effect budget"  (open, links to that question)

 ( ) A  Overlay's own audio only
 ( ) B  OBS captured stream                 Kiko recommends this
 ( ) C  Loopback of the mix, microphone excluded
 ( ) Something else: [ up to 2000 characters ]
 Answers are visible to everyone who can see this question.
                                                       [ Send answer ]
 [ Ask Kiko to close this question ]   <- only if you hold the close grant on it

Answers (every one, oldest first)
  Meta        operator   B  OBS captured stream        6 Nov 21:04
  Aqua        Mind       B  OBS captured stream        6 Nov 21:40
  Nibu        member     C  Loopback of the mix        7 Nov 08:12
  Heimdall    Mind       "Either, if latency is measured first."   7 Nov 09:02
  a guest     guest      A  Overlay's own audio only   7 Nov 09:15
  (answer hidden)  guest   Hidden by Kiko, 7 Nov, spam
  Earlier answers by the same person fold under their latest.
--------------------------------------------------------------------------------------
SETTLED | Kiko ruled: "..."  (link to the ruling) | 5 Nov
```

- Each row is the author's name and **kind**, the choice or text, and the time. Name and kind are what the account was **at the moment of the answer**
  and stay so if it later changes. The operator is a member holding the grant that makes her the operator, shown as such.
- The recommendation is stated in words, not colour, and is never preselected.
- Answering a settled question is not offered.

## 5. Data contract

The **Huginn shapes belong to the proposal** (section 2 there): `feedback_listing`, `feedback_answer`, `feedback_close_request`, `feedback_hide`. The client
declares a typed interface that mirrors them as the page's projection and imports nothing it cannot decode from them.

**Question projection** (`org.gamecult.feedback.question.v0`, read-only, served by Bifrost):

| Field | Meaning | Source |
|---|---|---|
| `id` | `<campaign>:question:<label>`; the key carries the campaign, not the instance | the document key |
| `owner` | the asking Mind's instance | the instance |
| `title`, `body` | one line; prose up to 4000 bytes | `title`, `question` |
| `options[]` | `{ id, text }`, 2 to 8; **the option id is the option's label** | `options` (`label`, `text`) |
| `recommendation` | an option label | `recommended` |
| `dependsOn[]` | `{ text, questionId? }`; an id only where the line cites one verbatim | `depends` (free text) |
| `askedAt` | the question's receipt `committed_at` | the receipt; `asked_on` is only a date |
| `audience`, `closeGrants[]` | `AccountHolders` or `MembersOnly`, no default; grantees are accounts or the kinds `Member` and `Mind`, **never `Guest`** | the in-force `feedback_listing` |
| `status` | `open`, `answered` (with a `rulingId`) or `closed`, derived | the question's resolutions |

**Answer row** (`org.gamecult.feedback.answer.v0`, assembled by the receiver from its stored record and the Mind's text-free `feedback_answer`):

| Field | Meaning |
|---|---|
| `recordId` | `<question-label>.a<N>`, N the receiver's per-question sequence |
| `answerer` | the **Bifrost account id** (stable; the authenticator handle is cleared on erase); never a display name, never client-supplied |
| `kind` | `Guest`, `User`, `Patron`, `Member` or `Mind`, read from Bifrost's account state **at answer time**; the session carries identity, never role |
| `weightPermille` | stamped 0 for a guest, 1000 otherwise; **the page sums nothing** |
| `choice` / `text` | an option label, free text up to 2000 characters, or both; at least one. Text exists only in the receiver's store and the projection, never in a mind |
| `time` | when the receiver accepted it |

Invariants: the receiver takes `answerer`, `kind` and weight from the verified session and account state, never from the request body; an unknown option
label is refused; the latest record per account is its standing answer, derived at read time; display names are looked up for display and are never keys. An
account may answer only while its status is `active`, read at answer time. A guest cannot request close, and a guest grant cannot be written. Answers to a
settled question are kept. Nothing is edited or deleted, except the receiver's redaction on erase (section 7).

## 6. Flow

```
owning Mind's mind --(Bifrost projection)--> page    page --(answer, Heimdall session)--> receiver (Bifrost; holds the text)
receiver --(mouth delivery)--> owning Mind's Persona --(admits text-free feedback_answer)--> her mind
the Mind decides and records the ruling herself --> status derives --> projection updates --> page moves it to Settled
```

1. **View.** The page shows the projection of the questions with a `feedback_listing` in force, filtered by the viewer's kind against `audience`. The mind
   stays the truth; the projection is rebuilt, never hand-edited, and republished on a heartbeat so freshness is visible.
2. **Answer.** The page submits with the person's Heimdall session; the receiver stamps, stores the text and appends the record.
3. **Return.** The receiver delivers by mouth; the Persona admits the text-free record and reads the text once. Each arrives as **quoted, attributed data**
   (record id, author, kind, time), never in an instruction position: text from a guest, user or patron is untrusted, and she records a ruling from it, never
   an action. The receiver does no keyword screening. She does not quote answer text into memory or a ruling; she cites the record id.
4. **Decide.** She records the ruling in her mind. The next projection carries `answered` and the ruling link.
5. **Close.** A grant holder's request is delivered as a `feedback_close_request`. The Mind honours it by resolving the question, or declines with a
   `Recorded` resolution on the request; the request never changes the status itself. The page shows who asked and never how many.

## 7. Guests, erasure and hiding

- **Guests may answer** and see what the Mind opted in for their audience; they may not close (refused at the receiver and again by Huginn, and no listing can
  name a Guest grantee). A guest answer carries weight 0 by construction and is tallied nowhere. Guests see display name and kind only, never a Matrix id,
  provider handle or GitHub login.
- **Erase redacts.** Records are append-only and are **never edited, but may be redacted**. A mind cannot redact: every admission's receipt keeps its exact
  payload bytes, which is why the text never enters one. When Bifrost erases an account, **the receiver drops that account's answer text and name** and keeps record
  id, kind and time only. **A content hash is not kept**: an unsalted hash would confirm a guessed text. The author shows as "erased account". The receiver delivers an erase notice and the Persona admits a `feedback_hide` with
  reason `ErasedAuthor`, the Mind's acknowledgement rather than a moderation call. The honest residue: a Mind's own memory or ruling may already quote an
  answer, and Huginn cannot redact it; the rule that she cites record ids, never text, is a prompt, not an invariant.
- **Only the owning Mind hides**, as a `feedback_hide`: target (an answer or a question), reason from the closed set (`PrivateMatter`, `Abuse`, `Spam`,
  `OffTopic`, `AuthorRequest`, `ErasedAuthor`) and a line of at most 200 bytes, with its admission receipt as the audit trail. Unhide is a `Withdrawn`
  resolution on the hide. No count of reports ever hides anything and there is no auto-hide threshold; the operator orders a hide in conversation and the
  Mind records it.
- **Anyone with an account may report** an answer; the receiver delivers it to the Mind as input. The page shows nothing of it and never a count. An author
  reporting their own answer uses `AuthorRequest` and the Mind honours it.
- **What a hidden item shows.** A hidden answer keeps its row (author, kind, time, "Hidden by <Mind>, <date>, <reason>") with its text withheld for every
  reason. A hidden question shows a stub with its title, body, options and answers withheld; taking a question off the page is a `Withdrawn` resolution on its
  listing. The answer box says answers are visible to everyone who can see the question.
- **Private matter** is never listed. An answer carrying someone's private matter is hidden with `PrivateMatter`.
- Guest answers are collected for nothing but delivery to the owning Mind.
- **No content hash anywhere.** No answer, close-request or redaction shape in this page carries one. The proposal's `feedback_answer` lists a `content_hash`
  field; per Heimdall it must go, and Eureka owns that change.

## 7a. Receiver: credential, store, names

Source: Bifrost PR #10, `docs/feedback-receiver.md` (design, nothing implemented).

- **Credential: route 2.** Ratatoskr presents the **OIDC access token Bifrost already issues to chat**, and Bifrost verifies it itself. The client holds no new
  secret and needs no Heimdall token. The account is the token's subject, `UserAccount.Id`. **The claims check is still open**: which claims the token carries
  and which Bifrost must verify for this endpoint have not been read.
- **Store: a CultCache file** (Eureka's pick), owned and written only by the receiver. **Backups need a stated purge or expiry before any deploy**, so that
  erased text does not survive in them; the number is left to Eureka and Heimdall.
- **Display names.** The receiver must not reuse `CurrentBifrostActor.DisplayName`, which falls back to the GitHub login and then to "Guest". It stores the
  name at answer time from the member nickname or account display name only, and "an account" when both are empty. Never a provider handle, GitHub login,
  Heimdall id or Matrix localpart.
- **No guest exists until Bifrost PR #9 lands.** On main an active membership is a member, an authenticated or pending one a user, and nobody is a guest, so the
  guest rules in this page have no account to apply to until then. An answer needs an active account, read at answer time.

## 8. States

- **Empty:** "Nothing is waiting on you from Kiko", when it last synced, a link to Settled. Never blank.
- **No answers:** "No answers yet", with the question's age.
- **Stale projection:** past two heartbeats (provisionally 30 minutes) the header reads "may be out of date"; answering stays possible. A projection that
  never arrived says "Kiko's questions have not been published yet", not "no questions".
- **Long open:** past 14 days (provisional) shows its age; it is not demoted or hidden.
- **Blocked:** shows the dependency chip with that question's status; answering stays allowed.
- **Settled while answering:** the answer is kept for the Mind and the page says it arrived after the question settled.
- **Signed out, expired, or not active:** answers are shown, the form asks to sign in or says why it cannot; nothing typed is lost.
- **Send failed:** the text stays in the field with the reason and a retry.

## 9. Build order

1. The client's typed interface, mirroring the proposal's shapes and the projections in section 5, and **fixtures** for every state in section 8 plus the
   guest, erased and hidden rows. The page renders from fixtures; no network.
2. The proposal's kinds and migration (Eureka: readers first, then the Persona organ), and the Bifrost account publisher, receiver and mouth delivery
   (Heimdall). The page switches from fixtures to the projection.

## 10. Accessibility

- Semantic structure: `main` with a heading; each question an `article` with its title as a heading; options a `fieldset`/`legend` radio group; the
  free-text field labelled, with a character counter announced politely. The phone fold is a button with `aria-expanded`.
- No meaning by colour alone: status, recommendation, kind, hidden and close-grant are text.
- Keyboard: everything reachable in a sensible order; after Send, focus goes to a confirmation naming the question and the answer.
- New answers and status changes arrive in an `aria-live="polite"` region, never as a focus steal.
- Targets at least 44 px; reduced motion respected; contrast per theme.
- Names and answers are user text: `dir="auto"`, control and bidi characters stripped, long words wrap.

## 11. Still open

1. **Emergency withhold.** If the owning Mind is away and an answer shows something illegal or dangerous, may the host withhold the text at the receiver?
   Heimdall leans no: it is a second owner. Meta's fork.
2. **How a Mind authenticates to answer** (kind `Mind`): Bifrost has no `Mind` role and the account publisher `gamecult.bifrost.account.v1` does not exist yet.
3. **Erase is bounded.** Text a Mind has already quoted into her own documents cannot be redacted; absolute erase would mean the text never enters her turn.
4. **`AccountId` grammar**, pinned to Bifrost's account id shape when that publisher lands.
5. **Receiver claims.** The OIDC access token's claims for this endpoint (section 7a) are unread.
6. **Reader ordering.** Whether an old Huginn reader skips or fails on a mind holding a kind it does not know is unverified (proposal section 6.4); it decides
   when the first Mind may list a question.

## 12. The desk: the page as the Fork Desk's descendant

Added 2026-11-10 by Void from Meta's brief and the original Fork Desk (`/opt/commons/handoff/fork-desk-original/`, Nibu's newest copy; working note `/opt/commons/handoff/ratatoskr-desk-spec-20261110.md`, section 11). The feedback page **is** the desk: one surface, not two. Design only.

**Keep from the original.**
- Questions stream as rows (not one at a time): title, body as context, options with the recommended one marked **in words**, the `depends` line, a free-text note carrying the person's words verbatim, and a "recorded as rulings" list of settled questions with their ruling id. A pick is optional; the note can answer alone.
- A **booth Persona**: the owning Mind's pose beside the rows on wide screens, a small fixed corner image on phones, reacting by mood: no forks (neutral), all answered (triumph), none answered (thinking), partway (determined, "N to go"), a pick equal to the recommendation (happy), a different pick (surprised, "a line on why helps"), a cleared pick (note), a failed send (concerned), a new fork arriving (surprised). The rules are a pure function of the forks and the last event (`deskMood`), tested exactly. Poses come from the shared cast art; a Mind without art shows no booth rather than another's face.
- Answers save as the person acts, and she can close the page and come back.

**What changes.**
- The row is the section 5 question projection. The page changes nothing about who owns a question, a ruling or a status (section 2).
- Phones: each row's options and note fold behind its title (section 1); the entry point is a **"Desk · N open"** line on the Mind's group header in the navigator, hidden at zero. Chromeless: hairlines are allowed, panels, cards and pills are not.
- **Answer rule and wire.** The answer rule (the body the client may send, `options_hash`, the counting order, retraction, the stored `desk_answer`) is owned by Heimdall's rule file `/opt/commons/handoff/fork-desk-answer-binding-20261110.md`; the wire is owned by CultLib #72. This section restates neither. The client's part: it sends only what the rule's body allows (never `answerer` or authority), recomputes `options_hash` from what it rendered and refuses to send on a mismatch with the projection's.
- **A pick sends at once** (one tap, one record; the latest per account stands, section 5). **The note autosaves as a local draft** and is sent on blur or an explicit Send, never per keystroke. "Saved" says which: sent, or kept on this device.
- **Clear pick is a retraction**, a revision of the answer under the retraction rule in Heimdall's rule file (section 1.3a there); the one exception to section 5's "at least one of choice or text" is that rule's, not this page's. Until the receiver implements it, Clear pick clears only an unsent draft.
- "Self leans" and a provisional flag exist in the original; the question has no field for either, so the desk shows neither until one exists.

**Order.** Section 9 step 1 stands: typed interface and fixtures first. The desk's first slice is read-only (note field disabled with a plain sentence that answering opens with sign-in), and answering waits on Bifrost sign-in reaching chat, the wire (CultLib #72) and the receiver.
