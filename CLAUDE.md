# ONE PIEXEL FIGHTING GAME — notes de travail

Jeu de combat 2D local dans le navigateur (Vite + TypeScript + Canvas 2D,
aucune bibliothèque de jeu). Tout vit dans `apps/web`.

## Commandes

`npm install`, `npm run dev`, `npm test`, `npm run build` (inclut `tsc`),
`npm run sprites` (Python : pillow, numpy, scipy).

## Découpage

```
apps/web/src/engine      Simulation pure et déterministe : aucun accès au DOM.
apps/web/src/characters  Données des combattants (un fichier chacun, découverte auto).
apps/web/src/render      Canvas : décor, sprites, VFX, HUD, police bitmap.
apps/web/src/audio       Effets et musique synthétisés en WebAudio.
apps/web/src/input       Clavier (codes physiques) et manettes → bits de boutons.
apps/web/src/game        Scènes (menus, sélection, combat, résultats), IA, salon et combat en ligne.
apps/web/src/net         En ligne : protocole, rollback, transport WebRTC (peerjs).
apps/web/src/settings.ts Réglages joueur (volumes, règles hors ligne, affichage), localStorage.
tools/sprites            Extraction des planches → atlas + manifestes JSON.
tools/stages             Mise à l'échelle des décors (+ ligne d'horizon).
```

**`engine` décide, tout le reste affiche.** `stepMatch(state, [bits, bits])`
avance d'une frame (60 par seconde) et renvoie des événements que la vue
transforme en effets et en sons. Positions en entiers (`PX = 256`
sous-pixels) : pas de flottant dans l'état, pour que le mode en ligne
(rollback, `net/rollback.ts`) rejoue les entrées à l'identique sur les deux
machines. Toute modification du moteur doit rester déterministe :
`net/fingerprint.ts` refuse de jumeler deux versions différentes. L'IA (`game/ai.ts`) ne fait que
renvoyer des bits de boutons, comme un clavier.

## Pièges connus

- Chaque `durations` d'un coup a exactement une entrée par frame de son
  animation ; `test/data.test.ts` le vérifie. Changer une animation dans
  `tools/sprites/chars/*.json` oblige à revoir le coup.
- `box: 'auto'` prend la portée calculée par l'extraction ; une frame sans
  portée ne touche pas. Mettre une boîte explicite dans ce cas.
- Un appui plus court qu'une frame est gardé par `gameTaps` jusqu'à
  `endInputTick()` : appeler cette fonction après chaque tick de jeu.
- Les noms de `sfx` sont de simples chaînes : `data.test.ts` vérifie qu'ils
  existent dans `audio/sound.ts`. Les `spark` sont typés (`engine/types.ts`)
  et dessinés dans `render/vfx.ts`.
- Nouveau combattant : l'ajouter à `ORDER` (`characters/index.ts`) et à
  `ARCADE_RANK` (`game/scenes.ts`). La sélection est une grille de 11 par
  rangée (`GRID_COLS`, `game/scenes.ts`).
- Les réglages (`settings.ts`, écran `game/settingsScene.ts`) ne touchent
  jamais l'état du moteur. Manches (`roundsFor`, `game/scenes.ts`) : `rounds`
  pour l'arcade et le versus ordinateur, `versusRounds` (menu VERSUS) pour
  J1 contre J2 local ; le combat en ligne garde ses règles fixes.
  `arcadeLevel` ne sert qu'à l'arcade.
- Décors : une peinture 16:9 par arène dans `assets/backgrounds/<id>.webp`,
  puis `python3 tools/stages/build_stages.py`. `HORIZON` y donne la ligne de
  la peinture posée sur le bord haut du sol, que le jeu dessine lui-même.
- La police bitmap n'a que les glyphes déclarés dans `render/font.ts` ; un
  caractère inconnu s'affiche `?`.
- Le site spritedatabase.net est bloqué depuis les sessions cloud : les
  planches sont déjà dans `assets/sheets`.

## Ressources

Planches issues d'un rip de ROM, non libres de droits, hors licence MIT. Voir
le README.
