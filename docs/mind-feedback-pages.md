# Mind feedback pages

Design only. No code exists for this; nothing here is built. Drafted by Kiko Self (2026-11-07) with Heimdall's draft rulings
on guests and hiding; placement ruled for this repo by Void. Follow-up `eureka-body:follow_up:ratatoskr-mind-feedback-pages`.
Every number below is provisional.

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
| The question | a typed `question` document in the **owning Mind's own mind** | a view of it; the page stores and edits nothing |
| Which questions appear | the owning Mind, by a typed opt-in act carrying an `audience` | shows only what was opted in |
| An answer | its author, as an append-only record | submits one record per answer |
| The ruling | the owning Mind, recorded by her | **never writes one**; links to it once she has |
| Status (open, answered, closed) | derived in the Mind from its documents, never written | shows it |
| Who answered, and as what | the Bifrost account behind the Heimdall session, plus its role at the moment of the answer | shows it; never takes it from the client |
| Close | a request the owning Mind honours | offers Close only to a grant holder; **the page writes no ruling** |
| Hiding | the owning Mind alone, as a typed act | shows the labelled stub; hides nothing itself |

An answer is input to a Mind, not a vote and not a decision. **The page never tallies**: no counts, no totals, no "leading" option, no
ordering by popularity, no count of reports or close requests. Only the Mind's ruling picks anything.

## 3. Receiver and carriers

- **Bifrost is the receiver** (Heimdall's side). It verifies the Heimdall session, reads the account, stamps `answerer`, `kind` and `time`,
  appends the record, delivers it to the owning Mind, and serves the projection the page reads. The client writes no record that carries
  identity; a Matrix sender is a different identity authority and never becomes `answerer`.
- **Huginn is RUDP-only.** The client never talks to Huginn. The Mind's questions reach the page as a projection Bifrost serves.
- **The Huginn kinds this needs are Eureka's:** the opt-in act with `audience`, `closeGrants` on a question, the close request, the hide and
  unhide acts, and the redaction record. This spec names what it needs and proposes no kinds. `huginn-feedback-kinds-proposal.md` was not in
  `/opt/commons/handoff` on 2026-11-07; the kinds wait on it.

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

Typed, closed, versioned by name. Logical shapes; the typed interface and its fixtures come first (section 9).

**Question** (`org.gamecult.feedback.question.v0`), projected read-only from the owning Mind's `question` document:

| Field | Meaning | Source |
|---|---|---|
| `id` | `<instance>:question:<label>` | the document key |
| `owner` | the asking Mind's instance | the instance |
| `title`, `body` | one line; prose up to 4000 bytes | `title`, `question` |
| `options[]` | `{ id, text }`, at most 8 | `options` (`label`, `text`) |
| `recommendation` | an option id or absent | `recommended` |
| `dependsOn[]` | `{ text, questionId? }`; an id only where the line cites one verbatim | `depends` |
| `askedAt` | UTC time | the mind keeps a date (`asked_on`); admission time fills the rest |
| `audience` | `account holders` (default) or `members only` | the opt-in act; **not in the mind today** |
| `closeGrants[]` | account ids and/or the kinds `member`, `mind`; never `guest` | a field the Mind sets; **not in the mind today** |
| `status` | `open`, `answered`, `closed`, derived; `answered` carries a `rulingId` | derived from the mind's documents |

**Answer** (`org.gamecult.feedback.answer.v0`), append-only:

| Field | Meaning |
|---|---|
| `questionId` | the question's id |
| `optionId` / `text` | an option id of that question, free text up to 2000 characters, or both; at least one |
| `answerer` | the **Bifrost account id** (the stable id, not the authenticator handle, which is cleared on erase); never a display name, never client-supplied |
| `kind` | `mind`, `guest`, `user`, `patron` or `member`, read from Bifrost's account state **at answer time**; the session carries identity, never role |
| `time` | when the receiver accepted it |

Further records, all append-only and delivered to the owning Mind as input: **close request** (requester, kind), **report** (reporter, kind, answer
id, reason code), **redaction** (answer id, content hash).

Invariants: the receiver takes `answerer` and `kind` from the verified session and account state, never from the request body; an unknown option id is
refused; the latest record per account is its standing answer, derived at read time; display names are looked up for display and are never keys.
An account may answer only while its status is `active`, read at answer time. Nothing is edited or deleted, with the single exception in 7.

## 6. Flow

```
owning Mind's mind --(Bifrost projection)--> page     page --(answer)--> Bifrost --(delivered)--> owning Mind
the Mind decides and records the ruling herself --> status derives --> projection updates --> page moves it to Settled
```

1. **View.** The page shows the projection of the questions the Mind opted in, filtered by the viewer's kind against `audience`. The mind stays the truth;
   the projection is rebuilt, never hand-edited, and republished on a heartbeat so freshness is visible.
2. **Answer.** The page submits a record with the person's Heimdall session; Bifrost stamps and appends it.
3. **Return.** Bifrost hands new answers to the owning Mind as input in her own conversation. Each arrives as **quoted, attributed data** (record id,
   author, kind, time), never in an instruction position: text from a guest, user or patron is untrusted, and she records a ruling from it, never an action.
   This is a delivery rule; the receiver does no keyword screening.
4. **Decide.** She records the ruling in her mind. The next projection carries `answered` and the ruling link.
5. **Close.** Close is a **request the owning Mind honours**. A grant holder's request is appended and delivered; the status becomes `closed` only when
   the Mind records the resolution. The page shows who asked and never how many.

## 7. Guests, erasure and hiding

- **Guests may answer** and see what the Mind opted in for their audience; they may not close. A guest answer carries no weight by construction: guests
  are on no roll and no tally. Guests see display name and kind only, never a Matrix id, provider handle or GitHub login.
- **Erase redacts.** Records are append-only and are **never edited, but may be redacted**. When an account is erased, each of its answers keeps its
  record id, kind, time and a content hash; the author shows as "erased account" and the text is dropped from storage and projection. This is the one
  case that bends pure append-only, because the text is the person's own words and erasure lets them take it back.
- **Only the owning Mind hides**, as a typed act with its admission receipt: target (an answer or a question), a reason code from a closed set
  (`private_matter`, `abuse`, `spam`, `off_topic`, `author_request`, `erased_author`) and a line of at most 200 bytes. Unhide is a later document, never
  an edit. No count of reports ever hides anything and there is no auto-hide threshold; the operator orders a hide in conversation and the Mind records it.
- **Anyone with an account may report** an answer; an author reporting their own uses `author_request` and the Mind honours it. A report changes nothing
  on the page and its count is never shown.
- **What a hidden item shows.** A hidden answer keeps its row (author, kind, time, "Hidden by <Mind>, <date>, <reason code>") with its text withheld for
  every reason; the body stays in the receiver's store for the Mind and operator to audit. A hidden question shows a stub with its title, body, options and
  answers withheld, which is the remedy for a question wrongly opted in. The answer box says answers are visible to everyone who can see the question.
- **Private matter** is never opted in. An answer carrying someone's private matter is hidden with `private_matter`.
- Guest answers are collected for nothing but delivery to the owning Mind.

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

1. The typed interface (question, answer, close request, report) and **fixtures** for every state in section 8, plus the guest, erased and hidden rows.
   The page renders from fixtures; no network.
2. The Huginn kinds (Eureka) and the Bifrost account publisher and receiver (Heimdall). The page switches from fixtures to the projection.

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
2. **How a Mind authenticates to answer** (kind `mind`): a Heimdall session of its own, or delivered through the receiver. Bifrost has no `mind` role today.
3. **Time precision.** `asked_on` is a date; `askedAt` takes the admission time, or the mind records a real timestamp (a schema change).
4. **Kind vocabulary.** The page's `guest | user | patron | member` plus `mind` follows Bifrost's role words; the Bifrost account publisher that supplies them
   does not exist yet.
