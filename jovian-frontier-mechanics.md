# JOVIAN FRONTIER — Mechanics Reference

*Working title. A competitive-or-cooperative card game of rival colonies clinging to the moons of Jupiter, each balancing raw survival against alliance and betrayal.*

> **Purpose of this document.** This is the rules spec to code against, not a rulebook for players. Where useful it points back to the `GameState` / `reduce()` model (the pure core + Lambda handler). All numbers are starting values meant to be playtested and tuned — collected in [§13 Tunable Values](#13-tunable-values).

---

## 1. High Concept

Each player is a fledgling colony on a Jovian moon (Io, Europa, Ganymede, Callisto, and outer stations for 5–6 players). The colony has two things that matter most:

- **Integrity** — the colony's cohesion and will, *a property of the player*. This is your life total. Combat and schemes grind it down.
- **Colony Core** — your reactor, your seat of power, and your **license to score objectives**. It is *not* your life total; it is a transferable asset. Break a rival's Integrity and you don't kill them — you **seize their Core**.

You win by **scoring objectives**, which both advance you toward victory and grant permanent advanced abilities. Aggression isn't about elimination; it's about stripping rivals of the Core they need to score.

- **Players:** 2–6
- **Turn structure:** one active player at a time, four phases (Attack → Action → Buy → Cleanup)
- **Hidden information:** your hand and deck are private; opponents see counts and your board

---

## 2. Colony Stats, Dispossession & Victory

The colony has **two intrinsic stats** — player-level, not cards, not per-turn resources: **Integrity** and **Loyalty**.

### Integrity (a player stat) — the colony's life

- Each player starts at **Integrity 10**.
- Unblocked attackers and certain schemes reduce your Integrity (see [§9 Combat](#9-combat)).
- Restored by Repair / Loyalty Boost cards, Bulwark abilities, and some cards. Integrity loss does not auto-heal.

### Loyalty (a player stat) — the colony's standing & devotion

Loyalty is your **strategic capital** for the soft-power game. Unlike the per-turn resources (⚡/⛏/✦) it is **intrinsic and persistent** — it does *not* refill each turn. You spend it down on big plays and must invest to rebuild it.

- Each player starts at **Loyalty 10**.
- **Spent on:** Scheme cards, diplomatic plays, and **scoring Diplomacy & Subterfuge objective tiers** ([§3](#3-objectives)).
- **Committed by engines:** anything that *builds or returns value over time* (recurring schemes, generators, persistent diplomatic structures) carries a **high upfront Loyalty cost** *and* **disproportionately higher ✦ requirements** than comparable one-shot cards. Whether that Loyalty is spent outright or locked-while-in-play is a design choice ([§14](#14-open-design-questions)).
- **Rebuilt by:** Loyalty Boost cards, holding Pacts, Diplomacy abilities, stable-governance cards.
- **Influence vs Loyalty:** ✦ is the *tactical fuel* spent and refreshed within a turn; Loyalty is the *strategic commitment* that persists across turns. Soft-power cards usually want both.

> *Optional consequence (flagged):* a colony at **Loyalty 0** is in unrest — e.g., cannot form new Pacts and is easier to scheme against — so Loyalty carries a floor risk, not just a wallet balance.

### Dispossession (Integrity reaches 0)

When your Integrity hits 0, the **aggressor who broke it seizes your Colony Core**. Then:

- **You keep playing.** Your Integrity resets to a **recovery value (5, = half max)** so you remain a live colony — you can still defend, attack, scheme, and form pacts. *(Proposed: without a reset a 0-Integrity player is trivially farmed. Flagged in [§14](#14-open-design-questions).)*
- **Without a Core you cannot score objectives** — scoring requires tapping a Core you own ([§3](#3-objectives)). This is the real penalty.
- **A captor may hold multiple Cores.** A held enemy Core still produces its base ⚡ for the holder (a power swing) and denies the victim scoring, but you may only ever tap **one** Core per turn to score — extra Cores are denial + power, not extra scoring.

### Reclaiming a Core (the comeback path)

A dispossessed player gets back in by either:

1. **Recapture** — reduce a Core-holder's Integrity to 0 and seize a Core (your choice of which, if they hold several), **or**
2. **Re-establish** — acquire an *Establish New Core* card from the Supply at steep cost.

### Winning

**Proposed default:** the first player to **score a Tier-3 objective wins** (the capstone). Because Tier 3 only unlocks after lower tiers are contested ([§3](#3-objectives)), the game builds toward a climactic finish, and a Core-less player simply cannot be the one to land it.

*Alternative (flagged):* a points race — each tier scored is worth escalating points, highest total when the first Tier-3 is scored. Decide this early; it's the single most structural open question.

### Cooperative texture ("with")

Diplomacy cards form **Pacts** (non-aggression, resource sharing). You cannot declare attacks against a pact partner while a Pact holds. Pacts break at an Influence cost with a penalty — the engine for betrayal. The Diplomacy objective track rewards this path directly.

---

## 3. Objectives

The scoring engine and the heart of the game.

### Setup — Directives

Objectives are **Directives**, transcribed from the spreadsheet's *Directives & Planets* sheet into `engine/directives.ts`. There are **six** — **Unification, Supremacy, Development, Prosperity, Subterfuge, Domination** — and **3 are drawn at random each game** as that game's tracks (`engine/setup.ts`; pin them via `SetupConfig.objectiveFlavors` for tests/demos).

### The ladder

Each Directive is an independent **ladder**:

> **Opener → Tier I → Tier II → (Tier III) → Finisher**

- **Opener** — a one-time bonus applied to *every* colony at game start (e.g. Unification: *Gain 1 Loyalty and Draw 1*; Prosperity: *Gain a Silicon*). See `applyOpeners()`.
- **Tiers I/II/(III)** — each has its **own** condition (not a shared global tier). Scoring a tier on your turn taps your Core (once/turn), advances *your* progress on that directive, and grants an advanced ability.
- **Finisher** — once you've cleared a directive's tiers, meeting its Finisher condition on your turn **wins the game**.

Progress is **per-player, per-directive** (`Player.directiveTier`), so each colony climbs its own tracks. Conditions are evaluated against live state by predicates in the registry; conditions that lean on subsystems the engine doesn't model yet (Cities, Unrest, Colony Renown, the Pillage token) keep the sheet's wording and use a flagged `≈` approximation.

### Scoring an objective (proposed mechanic)

To score, on your turn you must:

1. **Tap your Colony Core** (this is *why* no Core = no scoring, and why you score at most one objective per turn), **and**
2. **Pay the objective's cost**, which is *flavor-matched*: **Diplomacy & Subterfuge** tiers cost **Loyalty** (plus ✦); **Prosperity** and **Bulwark** tiers cost resources (⛏/⚡); **Domination** tiers cost resources and/or a combat prerequisite. Costs scale up by tier; exact numbers TBD.
3. **Meet the objective's condition** (below).

On scoring you gain (a) victory progress (the capstone / points toward the win) **and** (b) a **permanent advanced ability** tied to that objective — *each tier completed grants advanced abilities*, as you specified. Abilities are personal to the scorer.

### The five flavors (example tiers — tunable)

**Prosperity** — economic dominance
| Tier | Condition | Advanced ability |
|---|---|---|
| 1 | Generate ≥8 total resources (⚡+⛏+✦) in one turn | +1 ⛏ each Refresh |
| 2 | Keep ≥5 upkeep-requiring permanents powered at once | +1 Buy per turn |
| 3 | Generate ≥15 resources in one turn (or finish a Megastructure) | Structures cost 1 less to acquire |

**Domination** — military supremacy
| Tier | Condition | Advanced ability |
|---|---|---|
| 1 | Destroy an enemy permanent | Your Units gain +0/+1 |
| 2 | Reduce one opponent's Integrity by ≥4 in a single Attack phase | Attackers deal +1 Integrity damage |
| 3 | Seize an enemy Colony Core | Cores you capture can't be reclaimed for 1 extra round |

**Subterfuge** — espionage & schemes
| Tier | Condition | Advanced ability |
|---|---|---|
| 1 | Resolve 3 Scheme cards | Draw +1 when you play a Scheme |
| 2 | Disable/destroy an enemy Source by a non-combat effect | Schemes cost 1 less ✦ |
| 3 | Steal a card from an opponent, or disable a Core for a round | Once/round, redirect an attack aimed at you |

**Diplomacy** — alliance
| Tier | Condition | Advanced ability |
|---|---|---|
| 1 | Form a Pact | +1 ✦ each Refresh |
| 2 | Hold Pacts with ≥2 colonies through a full round | Gain a bonus when a pact partner scores |
| 3 | Broker a table-spanning agreement (pacts covering a majority) | Pact-break immunity / Shared-Victory eligibility |

**Bulwark** — defense & endurance
| Tier | Condition | Advanced ability |
|---|---|---|
| 1 | Be attacked and lose no permanents that Attack phase | +2 max Integrity |
| 2 | Control ≥3 defensive structures | Reduce incoming Integrity damage by 1 |
| 3 | Be targeted by ≥2 colonies in a round and end it with Integrity intact | Once per game, prevent Integrity from reaching 0 |

---

## 4. Resources & Player State

Three spendable resources plus capacity stats. **Resources are generated fresh each turn and lost at Cleanup unless Storage banks them** — that's what makes tap-for-resource feel "this turn only."

> ### The two-sided economy (headline rule)
>
> Cards fall into two cost classes with **opposite** timing — this is the core of the build:
>
> - **Resource cards are PAY-TO-ACQUIRE, FREE-TO-PLAY.** You spend resources to **buy** a resource card from its stack; once it's in your deck, playing it costs nothing and banks resources (Carbon → +1 ⛏, Silicon → +2 ⛏, …). Their printed cost is a **buy** price (bracketed `[m/i/either]` on the sheet).
> - **Every other card is FREE-TO-BUY, PAY-TO-PLAY.** You pull it **blind** off an Action stack for nothing; you pay its cost only when you actually **play** it. Its printed cost is a **play** price (un-bracketed `m/i/either`).
>
> Each card therefore carries a single cost paid at *different moments*: at **Buy** for resources, at **Play** for everything else (`engine.ts → chargedAtBuy`). Costs are **Minerals / Influence / Either**, where **Either** (a.k.a. *wild*) is payable from ⛏ **or** ✦.

| Resource | Icon | Produced by | Primarily spent on |
|---|---|---|---|
| **Energy** | ⚡ | Source cards + your Colony Core's base output | Upkeep to keep permanents powered |
| **Minerals** | ⛏ | Mineral cards, Mining Laser tap, structures | Structures & Upgrades (hardware) |
| **Influence** | ✦ | Influence cards, Security Officer tap, schemes | Diplomacy & Schemes (paired with Loyalty); per-turn fuel |

| Capacity stat | Default | Raised by | Effect |
|---|---|---|---|
| **Hand Size** | 5 | Satellite Comms, Core Amplifier, … (+1 each) | Max cards held through Cleanup |
| **Storage** | 1 | Trenchers, Resource Silos, … (+1/+2 each) | Unspent ⚡/⛏/✦ carried to next turn |
| **Buys** | 1 | Infrastructure Projects, Resource Silos, … (+N each) | Stack pulls allowed per Buy phase |

**Per-player state to track:** Integrity, **Loyalty**, Cores owned (own + captured), scored objectives, earned advanced abilities, resource pools, hand/storage/**buys** capacity, board permanents.

**Cost conventions under the two-sided economy:** **resource** cards carry a **buy** price (free at Tier I, rising at II/III, often paid mostly in *Either*); every other card carries a **play** price. A **Buy** consumes one of your **Buys** whether you're paying for a resource or pulling a free action card. **Energy is upkeep, not a cost paid for cards** — most permanents require ⚡ each turn to stay powered ([§8](#8-energy--upkeep)).

---

## 5. Card Types

| Type | On board? | Needs ⚡? | Notes |
|---|---|---|---|
| **Source** | Permanent | No (*produces* ⚡) | Reactors, Solar Arrays, Battery Banks |
| **Structure** | Permanent | Usually | Buildings (defense / economy). Most require power |
| **Unit** | Permanent | Maybe | Attack/Health; attack and defend; some require power |
| **Diplomat** | Permanent | Maybe | Drives ✦/Loyalty, enables Agreements; a prime scheme target |
| **Upgrade** | Permanent (attached) | Adds to host | Costs to play; **attaches to a host permanent** (structure/unit/diplomat/scheme) and modifies it. Falls off if the host leaves |
| **Operation** | No (one-shot) | No | Temporary boost lasting **one round**, then discarded |
| **Scheme** | Sometimes | Maybe | Costs Loyalty (+✦); **incubates**, then fires — *burst* (all at once) or *progressive* (a slice each tick). Interacts with a target player |
| **Agreement** | Permanent (Pact) | Maybe | Persistent **two-player** interaction; binding until broken |
| **Reaction** | No (one-shot) | No | Played during another player's Attack response window |

**Permanent** = anything that stays in play between rounds. Permanents are what Energy upkeep gates. **The Colony Core is special: it cannot be destroyed in combat and has no Health — it changes hands only via Dispossession.**

**Engine cards (build or return value over time)** — recurring schemes, generators, persistent diplomatic structures — carry a **high upfront Loyalty cost plus disproportionately more ✦** than one-shot cards of similar power. That premium is the price of a colony committing its devotion to a long game ([§2 Loyalty](#2-colony-stats-dispossession--victory)).

**Effect model (see `cards.ts`).** Every card is *data*, not bespoke code. A card is a list of **triggers** (*when* — `onPlay`, `startOfYourTurn`, `onAttack`, `onSchemeMature`, `whileInPlay`, …) each carrying **effects** (*what* — verbs like `modifyResource`, `modifyStat`, `modifyIntegrity`, `destroyPermanent`, `formPact`, `scheduleEffect`), aimed by a **target selector** (*who* — `self`, `targetPlayer`, `allOpponents`, `sourceCard`, `enemyPermanents`, …) for a **duration** (`instant`, `endOfRound`, `whilePresent`, `permanent`). That `trigger × effect × target × duration` shape is what lets one engine cover self-boosts, opponent impacts, persistent auras, temporary operations, upgrade attachments, and incubating schemes without code per card. Adding a card is adding data; only a genuinely new *verb* touches the interpreter. Reusable named abilities are catalogued in [Appendix A — Keyword Glossary](#appendix-a--keyword-glossary).

---

## 6. Starting Setup (per colony)

Permanents already in play plus a small cycling deck.

### In play at game start

| Card | Stats | Ability |
|---|---|---|
| **Colony Core** | no Health; base **+2 ⚡** / turn | Your scoring engine — **tap to score an objective** (once/turn). Cannot attack, cannot be destroyed; seized only via Dispossession. |
| **Security Officer** | 1 / 1 | **Tap: +2 ✦** this turn (then can't defend). |
| **Mining Laser** | modal | **Defense:** a 1/1 structure that blocks/attacks. **Economy:** *Tap: +2 ⛏* (then can't defend). Choose mode each turn. |

Your **Integrity (10)** and **Loyalty (10)** are player stats, not cards on the board.

### Starting deck (~8 cards, drawn 5/turn)

Where your "3 minerals, 3 influence" live — as basic cards, Dominion-style:

- **3× Mineral Cell** — *Play: +1 ⛏*
- **3× Influence Brief** — *Play: +1 ✦*
- **1× Repair / Loyalty Boost** (modal) — tends whichever intrinsic stat you need:
  - **Repair:** restore **+2 Integrity** to your colony (or heal a friendly structure/unit), **or**
  - **Loyalty Boost:** restore **+2 Loyalty**
- **1× Basic Solar Array** — starter Source (+1 ⚡, +1 hand size)

> The two modes map to the two intrinsic stats: Repair mends Integrity, Loyalty Boost rebuilds Loyalty — your early lever on each.

---

## 7. Turn Structure

One active player at a time. **Refresh → Attack → Action → Buy → Cleanup**; the four named phases match the `Phase` enum, Refresh is turn-start bookkeeping.

### 7.0 Refresh
1. Untap your permanents. 2. Produce Energy (Core base + Sources + any captured Cores you hold). 3. Pay upkeep ([§8](#8-energy--upkeep)) — underpowered permanents deactivate. 4. Draw to hand size. 5. Reset resource pools (carry over only within Storage).

### 7.1 Attack — *synchronous* (the `PendingGate`)
1. Active player declares attackers (untapped Units / defense-mode structures) and targets: enemy permanents, or a colony's **Integrity** if undefended. Attacking taps the attacker.
2. **Gate opens.** Each affected opponent simultaneously responds: assign blockers, play a Reaction, invoke a Pact, or take it.
3. When all have responded (or the timeout sweep fires), combat resolves at once ([§9](#9-combat)).

### 7.2 Action — *turn order (active player)*
Play cards; use Tap abilities; activate Schemes; form/break Pacts; **tap your Core to score an objective** if you meet its condition and pay its cost.

### 7.3 Buy — *turn order (active player)*
Acquire from the **Supply** ([§10](#10-the-supply)); acquired cards go to your discard (deckbuilder cycle). Default 1/turn.

### 7.4 Cleanup — *automatic*
Discard to hand size; clear marked combat damage; discard resources beyond Storage; pass turn.

---

## 8. Energy & Upkeep

- Each permanent has an **Upkeep** in ⚡ (Sources 0; most Units/Structures 1).
- At Refresh, Energy produced must be ≥ total upkeep, or the player **deactivates** permanents (powered-down: can't act or block, not destroyed) until balanced.
- **Battery Bank** Storage banks surplus ⚡ for burst turns.
- Destroying an enemy's Sources browns out their board next Refresh — a real attack vector. Seizing a Core also steals its base ⚡.

---

## 9. Combat

Stats are **Attack / Health** (Security Officer is 1/1).

- An attacker deals **Attack** to its target; an untapped defending Unit/structure deals its Attack back (mutual). Damage ≥ Health destroys (to discard).
- **Blocking:** a defender reassigns an attacker onto a blocker; they trade instead of the original target being hit.
- **Unblocked attackers reduce the defending colony's Integrity** by their Attack. At Integrity 0 → **Dispossession** ([§2](#2-colony-stats-dispossession--victory)).
- Some **Schemes** also reduce Integrity without combat.
- Non-Core combat damage clears at Cleanup unless a keyword persists it. **Integrity loss does not auto-heal** — it's restored only by Loyalty/Bulwark effects.

---

## 10. The Supply

Shared market for the Buy phase. The Supply is **one stack per (card type × tier)** — a buy source of every tier for every type of card — and **each stack is shuffled into a random order**. Represent as `supply: Record<"category:tier", BuyStack>` where a `BuyStack` is `{ category, tier, acquire, cards: CardId[] }` and `cards` is the shuffled draw order (top = last element).

- **Resource stacks** (`acquire: 'pay'`): the Mineral and Influence stacks at each tier (Carbon/Silicon/Titanium, Appeal/Compromise/Clout). Homogeneous, so you know what you're getting; **buying charges the card's cost**. Filled deep (≈10 each) — you draw on them all game.
- **Action stacks** (`acquire: 'free'`): one per faction-category × tier (Diplomacy I/II, Covert I/II, Warfare I/II, Mercenary I/II, Industrial I/II, Structure I/II, Battery II). Mixed cards, **shuffled**, so the available card is **random**. Buying is **free and blind** — you take the top card sight-unseen and pay only when you play it. Per the design note, ≈4 copies of each card per stack.
- **Blind Buy & Scout.** Because action stacks are face-down, buying is a *Blind Buy*. The **Scout X for Y** keyword (and cards like Radar Tower) let you look at the top X of a stack before taking one — the only way to see what you're pulling.
- **Buys** gate how many stack pulls you get per Buy phase (default 1, +N from cards). Resource purchases and free action pulls both consume a Buy.

---

## 11. Sample Card Stat Blocks

### Energy Sources
| Card | Output | Upkeep | Acquire | Notes |
|---|---|---|---|---|
| **Reactor** | +2 ⚡ | 0 | ⛏⛏⛏ | Raw power. Fat target. |
| **Solar Array** | +1 ⚡, +1 hand size | 0 | ⛏⛏ | Card flow. |
| **Battery Bank** | +1 ⚡, +1 storage | 0 | ⛏⛏ | Banks surplus. |

### Starter permanents (as data)
| Card | A/H | Upkeep | Ability | Modal? |
|---|---|---|---|---|
| **Colony Core** | — (no Health) | 0 | +2 ⚡; **Tap → score 1 objective** | no |
| **Security Officer** | 1/1 | 1 | Tap → +2 ✦ | no |
| **Mining Laser** | 1/1 | 1 | Tap → +2 ⛏ | yes (defense ⟷ economy) |
| **Repair / Loyalty Boost** | — | — | +2 Integrity ⟷ +2 Loyalty | yes |

---

## 12. Mapping to the Codebase

Aligning with the pure core (`game.ts`):

- **Phases** → `Phase` union `'attack'|'action'|'buy'|'cleanup'`; Refresh is turn-start logic.
- **Synchronous Attack** → `PendingGate`; extend `AttackChoice` with `block`/`pact`/`reaction`; unblocked attackers decrement defender `integrity`.
- **Player state** → add `integrity`, `loyalty`, `coresOwned: string[]`, `scoredObjectives`, `abilities`, `minerals`, `influence`, `storage`, `handSize`. Note `loyalty` **persists across turns** (unlike per-turn resources) and gates schemes, engine cards, and Diplomacy/Subterfuge scoring.
- **Objectives** → global game state: `activeFlavors: Flavor[3]`, `currentTier`, `scoredThisTier`, plus an objective registry (condition predicate + cost + ability). Scoring = predicate met + Core untapped + cost paid → tap Core, grant ability, increment tier counters.
- **Dispossession** → when `integrity <= 0`, transfer the Core's id from victim `coresOwned` to aggressor, reset victim integrity to recovery value.
- **Win check** (end of each `reduce`) → did anyone just score a Tier-3 objective (or hit the points target)?
- **Hidden info** → `viewFor` exposes board, Integrity, Cores owned, scored objectives; hides hands.

---

## 13. Tunable Values

| Knob | Start value |
|---|---|
| Starting Integrity | 10 |
| Integrity recovery after Dispossession | 5 (half) |
| Starting Loyalty | 10 |
| Loyalty model | spend-down vs commit-while-in-play (TBD) |
| Loyalty-at-0 consequence | unrest: no new Pacts, easier to scheme (optional) |
| Colony Core base Energy | +2 ⚡ |
| Objectives flavors in play | 3 of 5 (random) |
| Tiers per flavor | 3 |
| Tier-unlock threshold | 2 scored at current tier |
| Objective scores per turn (per player) | 1 (tap Core) |
| Win trigger | first Tier-3 objective scored |
| Base hand size / storage | 5 / 0 |
| Default upkeep (Unit/Structure) | 1 ⚡ |
| Buys per turn | 1 |
| Variable supply row width | 5 |
| Attack response timeout | 30 s |

---

## 14. Open Design Questions

1. **Win trigger.** Capstone (first Tier-3) vs points race. The most structural decision — lock it first.
2. **Scoring cost** is now flavor-matched (Diplomacy/Subterfuge → Loyalty + ✦; Prosperity/Bulwark → resources; Domination → resources/combat). Still TBD: exact amounts per tier, and whether scoring should *also* tap your defenses or cost Integrity to make the victory moment risky.
3. **Tier gating scope.** Global (2 scored across all tracks advances everyone — current reading) vs per-flavor (each track advances its own tiers independently).
4. **Integrity reset on Dispossession.** Reset to half (current), reset to full, or no reset (harsher). Affects how farmable a knocked-down player is.
5. **Captured Cores.** Do they power the captor (current: yes)? Can they be tapped to score (current: no — one score/turn regardless)? How fast can the victim reclaim?
6. **Establish New Core cost** — must be high enough that losing a Core stings but low enough that comeback is real.
7. **Advanced abilities — personal vs escalating.** Currently personal to the scorer; consider whether some tier completions shift global rules.
8. **Buy-to-deck vs buy-to-play**, **persistent vs resetting combat damage**, **faction asymmetry** (Io ⛏/⚡, Europa ✦/bio, Ganymede ⚡/defense, Callisto storage/economy) — add only after the symmetric base is fun.
9. **Loyalty model.** Spend-down pool vs committed-while-in-play (engines *lock* Loyalty, returned if the card is destroyed). The commit model makes big engines a tempting target and ties Loyalty directly to board risk — losing the engine hurts but refunds the devotion.
10. **Loyalty recovery & floor.** What rebuilds Loyalty and how fast; whether 0 carries the unrest penalty or is merely empty. Recovery has to keep pace with scheme/engine spend or the soft-power path stalls out.

---

## Appendix A — Keyword Glossary

Keywords are named, reusable rules so cards stay terse (a card can read just *"Bastion. Armor 1. Hardened."*). They come in two forms in the engine (`keywords.ts`):

- **Triggered** keywords *expand* into ordinary triggers (no engine change — they reuse the effect system).
- **Static** keywords are *flags the rules engine queries* at fixed checkpoints (block legality, damage, upkeep, targeting, incubation, pact-break).

Parameterized keywords carry an **N** and **stack by summing** (Armor 1 + an upgrade's Armor 1 = Armor 2). Keywords may be **printed** on a card or **granted** temporarily; "does this card have keyword X right now?" is recomputed live from printed + attached upgrades + active grants.

### Offense
| Keyword | Kind | Rule |
|---|---|---|
| **Ambush** | static | Deals combat damage first; survives if it kills its blocker |
| **Breach** | static | Combat damage beyond a blocker's health carries to that colony's Integrity |
| **Siege N** | parameter | +N Integrity damage when attacking a colony |
| **Infiltrator** | static | Cannot be blocked |
| **Rapid** | static | May act the turn it enters play (no summoning sickness) |

### Defense
| Keyword | Kind | Rule |
|---|---|---|
| **Bastion** | static | Attackers must resolve against this before the colony or other permanents |
| **Shielded** | consumable | Prevents the next damage dealt to it, then is removed |
| **Armor N** | parameter | Reduce each incoming combat-damage instance by N (min 0) |
| **Hardened** | static | Immune to deactivation and non-combat destruction (only combat kills it) |
| **Self-Repair N** | triggered | Remove N damage at the start of your turn |

### Power
| Keyword | Kind | Rule |
|---|---|---|
| **Off-Grid** | static | Ignores upkeep; never browns out from a power shortfall |
| **Efficient N** | parameter | Upkeep reduced by N |

### Subterfuge / Schemes
| Keyword | Kind | Rule |
|---|---|---|
| **Covert** | static | While incubating, opponents can't see this scheme or its target |
| **Catalyst N** | parameter | Incubation delay reduced by N (min 0) |
| **Recurring** | static | After maturing, re-incubates instead of discarding (engine card; high Loyalty) |
| **Backlash N** | triggered | If disrupted before maturity, the disruptor loses N Integrity |

### Diplomacy / Loyalty
| Keyword | Kind | Rule |
|---|---|---|
| **Inspiring N** | triggered | +N Loyalty at the start of your turn while in play |
| **Binding N** | parameter | This Pact cannot be broken for N rounds |
| **Liaison N** | parameter | Your Agreements cost N less ✦ |
| **Scheme-Proof** | static | Cannot be targeted by enemy schemes |

> **Designer note.** Keep printed keyword counts low (2–3 per card); rely on stacking and granted keywords for the spikes. *Inspiring* is your main Loyalty inflow lever — make sure enough cards carry it that the soft-power economy doesn't deadlock (see [§14](#14-open-design-questions), Loyalty recovery).
