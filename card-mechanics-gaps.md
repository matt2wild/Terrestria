# Card Mechanics — Gap Analysis

Which **action-card mechanics referenced in `catalog.ts` text are NOT modeled by the
engine** (`engine/*.ts`). Companion to `test/action-cards.test.ts`, where every gap
below is a `{ todo: true }` test.

> Scope: the playable ACTION cards (operations + permanents in the buy stacks) plus the
> two founder operations. Resource cards, the Colony/Core/Waste cards, and the directive
> ladders are out of scope here.

---

## 1. What the engine actually models

So the gaps are concrete, here is the complete implemented surface.

**Effect verbs** (`engine/effects.ts → applyEffect`): `modifyResource` (minerals /
influence / energy / loyalty), `modifyLoyalty`, `modifyIntegrity` (with Dispossession
check), `modifyStat` (instant heal/damage only — adjusts the `damage` rider, never base
stats), `drawCards`, `destroyPermanent`, `grantKeyword`, `formPact`, `scheduleEffect`
(incubation).

**Trigger events that actually fire**: `onPlay` (reducer), `onActivate` (reducer, with a
**ResCost** cost and optional `taps`), `onDestroy` (`destroy`), `whileInPlay` (read only
by `eff()`, and only for an **upgrade's** stat aura), `startOfYourTurn` (the *only* event
`dispatch()` is ever called with — at Refresh). No other event name is dispatched.

**Passive permanent stats** (`engine/turn.ts → refresh`): `produces` (power), `handBonus`,
`storageBonus`, `buyBonus`, `upkeep`.

**Keywords referenced in code**: `rush`/`rapid` (attack the turn played), `armor N`
(reduce combat damage), `siege N` (bonus integrity damage), `breach` (overkill → integrity),
`shielded` (consume to block one hit), `infiltrator`/`ghost` (unblockable), `hardened`
(survive destroy), `efficient N` (−upkeep), `offGrid` (zero upkeep), `catalyst N`
(−incubation delay).

**Combat** (`engine/combat.ts`): declare → block → simultaneous resolve, armor, shields,
breach, siege, dispossession, and the pact "can't attack a partner" rule. Blocking is
**voluntary and unconstrained**; there is no army/aura layer, no attacker/defender
sub-steps exposed to cards, and no "Durability" stat distinct from health.

---

## 2. Systemic gaps (each blocks many cards)

| # | Missing mechanic | Why it's missing | Cards affected (sample) |
|---|---|---|---|
| 1 | **Choose-One / modal effects** | reducer applies *all* `onPlay` effects; no mode selection | colony-drones, colony-aid, improve-relations, protective-services, triple-point, symbol-of-unity |
| 2 | **`ACTION (n)` power-cost activated abilities** | none encoded; and `onActivate.cost` is `ResCost` with **no energy field**, so a power cost can't even be expressed | priority-briefings, infrastructure-projects, diplomatic-corps, trade-posts, avion-bike-squadron, a25-roman-prime, redrock-overloaders, carbon-tank, courier-network, sectorwide-expansion, symbol-of-unity |
| 3 | **Loyalty-threshold modes (`NL ->`)** | no concept of gating/spending Loyalty for a card ability | protectorate-colony, planetary-unification, colony-of-progress, scythian-footsoldiers, salvaged-apc, kinetic-riflemen, scythian-grenadiers, orbital-relay-network, redrock-despoilers, world-dominion, starhawk, radar-tower, resource-silos, capacitor-bay, kinetic-artillery, a25-roman-prime |
| 4 | **Discard effect** | no `discard` verb | diplomatic-corps, breaking-relations, non-aggression-pact, redrock-grunts, trade-posts |
| 5 | **Waste-from-hand** | `waste` is only a card *kind* (Slum); no verb turns a hand card into Waste | colony-aid, evacuate, recycling-initiatives, lucky-find, titanic-freighter, protective-services |
| 6 | **Expend units / `onExpend` trigger** | `tapped` exists but there is no Expend cost and no expend event | peaceful-protests, protective-services, scythian-footsoldiers, redrock-grunts, redrock-despoilers, hired-thieves, scythian-assassins |
| 7 | **Planetfall trigger** | not dispatched | trade-posts, redrock-grunts |
| 8 | **Counter-Operation / instant-speed play** | cards play only on your own turn (no phase guard, but no reactive window during the gate) | peaceful-protests, evacuate, triple-point, airstrike, lucky-find |
| 9 | **Gainable "Wild"** | wild is a *cost type*, not a player pool — cannot be gained | scythian-footsoldiers, orbital-relay-network, radar-tower, resource-silos |
| 10 | **Combat auras (Shields / Attack / Durability to armies)** | `eff()` reads only the card's own base + its upgrades; no board-wide auras | barracks, firing-range, scythian-grenadiers, a25-roman-prime, kinetic-artillery, world-dominion, planetary-unification, protectorate-colony, starhawk |
| 11 | **Durability stat & `+1 Durability`** | engine has only `health`; no Durability modifier | scythian-footsoldiers, salvaged-apc, kinetic-riflemen, redrock-despoilers, avion-bike-squadron, colony-trenches |
| 12 | **Permanent stat growth / `+1/+1` counters** | `modifyStat` only adjusts the instant `damage` rider, not base stats | trenchers |
| 13 | **Token creation** | `newInst` is internal; no verb | sectorwide-expansion |
| 14 | **Attach-from-hand as a play** | `upgrades`/`attachedTo` exist and `eff()` reads them, but no verb attaches a card | carbon-tank, trenchers |
| 15 | **Defender constraints (Forward / must-Defend / Vigilance)** | blocking is voluntary; no forced/required defenders | protectorate-colony, kinetic-artillery |
| 16 | **`onDefend` / `whenAttacked` / `on-deal-damage` triggers** | only `startOfYourTurn` is dispatched | impassioned-speakers, trade-posts, world-dominion |
| 17 | **Phase-specific triggers (start of Buy Phase, before Defenders)** | only Refresh dispatches; phase changes dispatch nothing | hired-thieves, infrastructure-projects, colony-trenches, courier-network |
| 18 | **Buy-cost modifiers** (cost-less, waivers, dynamic) | `buyCard` always charges the printed cost; no modifier layer | infrastructure-projects, courier-network, docking-bay, capacitor-bay, improve-relations, manpower |
| 19 | **One-shot `+Buy` from an operation** | `buys` is set at Refresh from `buyBonus` only; no verb touches it | lucky-find |
| 20 | **Opponent-targeted draw** | `drawCards` supports `targetPlayer`, but these cards encode `self` only | trade-agreement, non-aggression-pact, trade-posts |
| 21 | **Disable** (tap/deactivate as an effect) | `tapped`/`active` exist but no verb sets them | evacuate, triple-point, redrock-overloaders, scythian-assassins |
| 22 | **Reveal hand** | no info-reveal verb | redrock-grunts |
| 23 | **Scout / deck peek / blind-buy look** | no info-zone manipulation | priority-briefings, radar-tower, orbital-relay-network, capacitor-bay |
| 24 | **"operations played this turn" counter** | not tracked on `Player` | interrogations |
| 25 | **Loyalty cubes on cards** | a whole sub-system (placing/owning cubes on permanents) | trade-posts, planetary-unification, protectorate-colony, colony-of-progress |
| 26 | **Ready / untap as an effect** | no verb | colony-trenches |
| 27 | **Gain-a-card-from-supply** | no verb adds a chosen supply card to your deck/discard | lucky-find, titanic-freighter, redrock-grunts, redrock-despoilers |
| 28 | **Counter-/extra-hit combat effects** | resolution has no "produce N hits and assign" step | starhawk |

---

## 3. Per-card breakdown

Legend: **Modeled** = parts that work today (covered by a passing test); **Gap** = text
the engine ignores (covered by a `todo` test).

### Founder operations
| Card | Modeled | Gap (systemic #) |
|---|---|---|
| colony-drones | `+2 Integrity` | resource mode (1) |
| colony-aid | `+1 Loyalty` | "Pay 1 Loyalty, Waste 1" mode (1, 5) |

### Diplomacy / Covert
| Card | Modeled | Gap |
|---|---|---|
| peaceful-protests | `+1 Loyalty` | Expend (6), Counter timing (8), cancel attack, attacker −Loyalty |
| improve-relations | playable | **encodes both draw+loyalty; should be Choose-One** (1); opponent-picks mode; "−1 Hard cost buy" (18) |
| propaganda | `+1 Influence`, target `+1 Loyalty` | — *(targets opponent by default; pass `chosen` for self)* |
| priority-briefings | enters play | deck peek (23), `ACTION (2)` draw (2) |
| trade-agreement | self `Draw 2` | partner `Draw 2` (20) |
| impassioned-speakers | 1/3 unit, upkeep | `onDefend` opponent −Loyalty (16) |
| infrastructure-projects | `+1 Buy` | `ACTION (1)` buy-cost reduction (2, 18) |
| diplomatic-corps | 0/3 enhancement | Loyalty-gain replacement (16), `ACTION (3)` draw/discard (2, 4) |
| non-aggression-pact | self `Draw 2`, `+1 Loyalty` | partner benefit (20), binding attack-tax (8) |
| evacuate | `+1 Loyalty` | Waste (5), Disable (21), combat removal, Counter (8) |
| a-new-start | `+1 Loyalty`, opponents `−1` | — *(fully modeled)* |
| indoctrination | `+2 Influence`, target `+2 Loyalty` | — |
| breaking-relations | `+2 Influence`, target `−2 Loyalty` | per-opponent Discard (4) + "lost-loyalty-this-turn" tracking |
| interrogations | `+2 Influence` | Draw per operation played (2-counter 24) |
| triple-point | `+1 Loyalty`, target `−1` | second modal swing (1), Disable chain (21), assault timing (8) |
| dissent | `+1 Influence`, target `−1 Loyalty` | — |
| trade-posts | 3/4 unit | Planetfall (7), cubes (25), `whenAttacked` (16), `ACTION (1)` shared draw (2) |
| protectorate-colony | `+1 Handsize`, 4/4 unit | Forward/must-Defend/Vigilance (15), `XL ->` Shields (3, 10) |
| planetary-unification | 0/3 fort | start-of-turn cube placement (25), `3L ->` whenAttacked Shields (3, 10, 16) |
| colony-of-progress | doctrine in play | `4L ->` cube valuation (3, 25) |

### Warfare / Mercenary
| Card | Modeled | Gap |
|---|---|---|
| retired-veterans | 2/2 vanilla | — *(fully modeled)* |
| scythian-footsoldiers | 2/1 unit | onExpend gain-Wild (6, 9), `1L ->` Shields (3) |
| redrock-grunts | 2/2 unit | Planetfall reveal+discard (7, 22, 4), onExpend gain-a-card (6, 27) |
| scythian-assassins | 2/1 unit | `2L:` damage-a-unit + self-expend (3, 6) |
| avion-bike-squadron | 3/1, **Rush** | `ACTION (1)` Durability buff (2, 11) |
| protective-services | playable | Expend-for-modes (1, 6) — *no triggers encoded* |
| airstrike | `−2` to a Colony | combat-time mode, damage-a-permanent + Shields (8) |
| salvaged-apc | 2/3, **Armor 1** | enter-play Loyalty-for-Rush (3), `2L ->` Durability (3, 11) |
| hired-thieves | 0/3 enhancement | start-of-Buy-Phase conditional per-expended payout (17, 6) |
| kinetic-riflemen | 2/3 unit | `2L -> +1 Attack`, `1L -> +1 Durability` (3, 11) |
| a25-roman-prime | 2/4 unit | `ACTION (1) +1 Attack` (2), `1L ->` enemy −Shields aura (3, 10) |
| scythian-grenadiers | 3/3 unit | opposing-army −Shields aura (10), `1L ->` fort debuff (3, 10) |
| orbital-relay-network | enhancement | deck-placement on gain (23), `1L/2L -> +1 Wild` (3, 9) |
| redrock-despoilers | 3/2 unit | onExpend gain-a-card (6, 27), `2L ->` Durability ×2 (3, 11) |
| groditz | 2/3, **Armor 2** | after-Defenders +Attack-per-enemy (16) |
| redrock-overloaders | 2/3 unit | `ACTION (3)` Disable chain (2, 21) |
| avion-hovertank | 4/3, **Armor 2 + Rush** | — *(fully modeled)* |
| manpower | `Draw 3` | dynamic −Wild per unit (18) |
| world-dominion | 0/3 fort | Rush aura to all units (10), damage→lifegain (16), `4L ->` combat buff (3, 10) |
| starhawk | 4/4, **Armor 2** | `4L ->` extra-hits after Defenders (3, 28) |

### Industrial / Structure
| Card | Modeled | Gap |
|---|---|---|
| carbon-hull | 0/3 vanilla | — *(fully modeled)* |
| repair | `+2 Integrity`, `+1 Mineral` | — |
| radar-tower | 0/2 enhancement | Blind-Buy scout (23), `2L -> 1 Wild` (3, 9) |
| lucky-find | playable | one-shot `+1 Buy` (19), Waste (5), opponent-gain trigger → gain-a-card (16, 27) |
| trenchers | `+1 Storage` | `2A+1R ->` permanent +1/+1 + Exhaust (12) |
| colony-trenches | 0/2 fort | before-Defenders Ready + temp buffs (17, 26, 11) |
| courier-network | `+1 Storage` | `1A` next-buy −Influence (2, 18) |
| recycling-initiatives | `Draw 1`, `+2 Integrity` | Waste (5) |
| satellite-comms | `+1 Handsize` | — *(fully modeled)* |
| carbon-tank | 3/2, **Armor 1** | `ACTION (3)` attach-resource upkeep-waiver (2, 14) |
| resource-silos | `+2 Storage`, `+2 Buys` | `3L -> +1 Mineral, +1 Wild` (3, 9) |
| barracks | 0/4 fort | all-units +1 Durability aura (10, 11) |
| firing-range | 0/4 fort | all-units +1 Attack aura (10) |
| docking-bay | `+1 Buy` | Silicon/Titanium mineral-cost waiver (18) |
| capacitor-bay | enhancement | Battery −2 cost (18), `2L ->` deck placement (3, 23) |
| titanic-freighter | playable | Waste (5), gain-a-Tier-III-Resource (27) |
| emergency-action-plan | `+4 Integrity`, `+2 Min`, `Draw 2` | — *(fully modeled)* |
| symbol-of-unity | enhancement | gain-Integrity/Loyalty → Draw, 3×/turn cap (16), `A2 ->` modal + Exhaust (1, 2) |
| kinetic-artillery | 3/5 unit | must-Defend (15), `4L ->` scaling −Shields aura (3, 10) |
| sectorwide-expansion | `+1 Hand/+1 Storage/+1 Buy` | `ACTION (2)` token copy (2, 13). *("may exceed 20 Integrity" is already true — integrity is uncapped.)* |

### Battery
| Card | Modeled | Gap |
|---|---|---|
| solar-power-grid | `+1 Power` | — *(fully modeled)* |
| battery-unit | `+2 Power`, `+1 Storage` | — *(fully modeled)* |
| fusion-reactor | `+3 Power`, `+1 Handsize` | — *(fully modeled)* |

---

## 4. Fully-modeled cards (no gaps)

These need no engine work — their tests should all pass green:
`a-new-start`, `propaganda`, `indoctrination`, `dissent`, `repair`,
`emergency-action-plan`, `manpower` *(except dynamic cost)*, `retired-veterans`,
`carbon-hull`, `avion-hovertank`, `satellite-comms`, `solar-power-grid`,
`battery-unit`, `fusion-reactor`.

## 5. Note on `improve-relations` (a current encoding bug, not just a gap)

Its catalog entry runs `onPlay(drawN(1), loy(1))` — applying **both** halves — but the
card is "**Choose One**: Draw 1 / Gain 1 Loyalty / buy at −1". Today playing it gives a
free card *and* loyalty. The `todo` test pins the intended "exactly one mode" behavior.

## 6. Suggested build order (highest leverage first)

1. **Choose-One / modal effects** (#1) and **Discard** (#4) — small, unblock the most cards.
2. **`ACTION (n)` activated abilities** (#2) — needs an `energy` field on `onActivate.cost`
   (or a dedicated power cost); unblocks ~11 cards.
3. **Loyalty-threshold modes** (#3) — the single biggest unlock (~16 cards); design the
   `NL ->` ability shape once.
4. **Combat auras + Durability** (#10, #11) — the second big bucket; requires an aura layer
   in `eff()`/combat.
5. The remaining triggers (#7, #16, #17) and the cube sub-system (#25) last.
