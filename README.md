# One Piexel Fighting Game

Jeu de combat 2D en pixel art dans le navigateur, dans l'univers de *One Piece*,
construit comme un Street Fighter : combos, gardes haute et basse, coups
directionnels, spéciaux à manipulation, projections, jauge de garde et
ultimes avec arrêt sur image.

Trente-trois combattants (voir le tableau plus bas), six arènes, un mode arcade avec fin, un versus à deux sur le même
clavier (ou deux manettes), un versus contre l'ordinateur (5 niveaux) et un
mode entraînement (mannequin configurable, affichage des boîtes de coup,
liste des coups dans le menu pause).

## Jouer

```bash
npm install
npm run dev        # http://localhost:5173
```

| | Joueur 1 | Joueur 2 |
| --- | --- | --- |
| Se déplacer / sauter / s'accroupir | Z Q S D (W A S D en QWERTY) | Flèches |
| [A] coup léger | C | J (ou Pavé 1) |
| [B] coup fort | V | K (ou Pavé 2) |
| [C] spécial | B | L (ou Pavé 3) |
| Projection ([A]+[B]) | F | U (ou Pavé 4) |
| Ultime ([B]+[C]) | G | I (ou Pavé 5) |
| Ultime max ([A]+[B]+[C]) | H | O (ou Pavé 6) |
| Pause | Échap | Retour arrière |

Seul devant l'écran (arcade, contre l'ordinateur, entraînement, en ligne),
les deux jeux de touches pilotent le même combattant : Z Q S D + J K L
marche comme avant.

Manettes PS4, PS5, Xbox et Switch Pro (USB ou Bluetooth) : elles
apparaissent dès qu'on appuie sur un de leurs boutons. La première branchée
joue J1, la seconde J2 ; une manette garde son côté si l'autre est
débranchée. Les boutons sont les mêmes par position sur toutes :

| | PlayStation | Xbox | Switch Pro |
| --- | --- | --- | --- |
| Se déplacer | Croix ou stick gauche | Croix ou stick gauche | Croix ou stick gauche |
| [A] coup léger | Carré ou Croix | X ou A | Y ou B |
| [B] coup fort | Triangle | Y | X |
| [C] spécial | Rond | B | A |
| Projection ([A]+[B]) | L1 | LB | L |
| Ultime ([B]+[C]) | R1 | RB | R |
| Ultime max ([A]+[B]+[C]) | L2 ou R2 | LT ou RT | ZL ou ZR |
| Pause | Options | Menu | + |

Dans les menus, le bouton du bas valide et celui de droite revient en
arrière. La manette vibre quand son combattant est touché, là où le
navigateur le permet (Chrome, Edge). Les touches sont lues par leur position physique : la même
disposition marche en AZERTY et en QWERTY.

### Palette de coups (commune à tous)

| Commande | Coup |
| --- | --- |
| [A], [A] [A], [A] [A] [A] | Enchaînement léger |
| [B] / → [B] / ← [B] | Coup fort, coup haut (à parer debout), lanceur |
| ↓ [A] / ↓ [B] | Coup bas / balayage (à parer accroupi) |
| Saut + [A] / [B] / [C] | Attaques aériennes |
| [C] ou ↓↘→ [C] | Spécial neutre (souvent un projectile) |
| → [C] | Spécial avant |
| ↑ [C] ou →↓↘ [C] | Spécial montant, invulnérable au début |
| ↓ [C] ou ↓↙← [C] | Spécial bas |
| [A]+[B] près | Projection (se dégage en appuyant aussi sur [A]+[B]) |
| [B]+[C] | Ultime, coûte une barre |
| [A]+[B]+[C] | Ultime max : la technique la plus forte du combattant, coûte les deux barres |
| →→ / ←← | Ruée / pas arrière |

Un seul ultime par round et par joueur (l'un ou l'autre) ; l'ultime max se
débloque au round 2. La jauge se garde d'un round à l'autre. L'entraînement
n'a pas de limite.

### Combattants

Chaque coup reprend l'animation et les effets de la planche du jeu DS.

| Combattant | [C] | → [C] | ↑ [C] | ↓ [C] | Ultime | Ultime max |
| --- | --- | --- | --- | --- | --- | --- |
| Luffy | Gomu Gomu no Pistol | Gomu Gomu no Gatling | Gomu Gomu no Rocket Uppercut | Gomu Gomu no Bazooka | Gear Third — Gigant Rifle | Gear Third — Gigant Axe |
| Zoro | Sanjūroku Pound Hō | Oni Giri | Ō Tatsumaki | Tatsumaki | Santōryū Ōgi — Rokudō no Tsuji | Sanbyakurokujū Pound Hō |
| Nami | Thunderbolt Tempo | Mirage Tempo | Swing Arm | Cyclone Tempo | Mirage Tempo — Fata Morgana | Thunder Lance Tempo |
| Usopp | Hissatsu Namari Boshi | Hissatsu Kaen Boshi | Kabuto — Usopp Rolling | Hissatsu Tabasco Boshi | Usopp Hammer « 10 t » | Sogeking — Hi no Tori Boshi |
| Sanji | Diable Jambe — Premier Hachis | Diable Jambe — Flambage Shot | Party Table Kick Course | Concassé | Poêle à Frire : Spectre | Diable Jambe — Hell Memories |
| Chopper | Arm Point — Kokutei | Heavy Gong | Heavy Point — uppercut | Heavy Point — martèlement | Kokutei Roseo | Monster Point |
| Robin | Seis Fleurs | Cien Fleurs — arbre de bras | Cien Fleurs Wing | Gigante Fleur | Mil Fleurs — Gigantesco Mano | Cien Fleurs — Delphinium |
| Franky | Strong Right | Coup de Boo | Weapons Left | Fresh Fire | Franky Rocket Launcher | Coup de Vent |
| Vivi | Karoo, fonce ! | Karoo — Peacock Slasher roulant | Peacock Slasher — tourbillon | Danse du parfum | Kujaku Slasher Ranbu | Chō Karugamo Butai |
| Ace | Hiken | Higan | Hibashira | Enjōmō | Dai Enkai — Entei | Jūjika — Cross Fire |
| Marco | Flamme bleue | Vol du phénix | Envol du phénix | Charge des ailes | Phénix — flammes régénératrices | Hōō-in — piqué du phénix géant |
| Barbe Blanche | Gura Gura — onde de choc | Gura Gura — poing séisme | Moulinet du bisento | Gura Gura — saisie de l'air | Kaishin | Shima Yurashi |
| Jinbei | Murasame | Samegawara Seiken | Kairiken | Senmaigawara Shōtei | Gyojin Karate Ōgi — Buraikan | Jinbei-zame Enbu |
| Buggy | Bara Bara Hō | Bara Bara Senbei | Bara Bara Kinkyū Dasshutsu | Buggy Ball | Bara Bara Festival | Captain Buggy !! Charge des évadés |
| Crocodile | Desert Spada | Barchan | Desert Grande Espada | Desert Girasole | Sables — Tempête du désert | Sables Pesado |
| Hancock | Pistol Kiss | Mero Mero Mellow | Salto de la Gorgone | Slave Arrow | Perfume Femur | Grand Mero Mero Mellow |
| Mihawk | Zangeki — croissant volant | Ruée de Yoru | Taille céleste | Kogatana | Yoru — entaille géante | Kokutō Issen |
| Doflamingo | Tamaito | Overheat | Fulbright | Parasite | Torikago — Birdcage | Kakusei — Awakening |
| Kuma | Tsuppari Pad Hō | Téléportation — Pad Hō | Pad Hō ascendant | Onde du tyran | Ursus Shock | Laser du Pacifista |
| Ivankov | Death Wink | Emporio Drill Kick | Emporio Face-Growth Hormone | Hormone de la tête géante | Hell Wink | Galaxy Wink |
| Magellan | Hydra | Doku Fugu | Hydra ascendante | Doku Gumo | Venom Demon — Jigoku no Shinpan | Doku Hydra — la Hydre géante |
| Hody Jones | Uchimizu | Shark Darts | Trident du requin | Ikaku Dōjō | Uchimizu — déluge | Energy Steroid — forme monstrueuse |
| Law | Radio Knife | Injection Shot | Takt | Shambles — Counter Shock | Room — Amputate | K-Room — Puncture Wille |
| Kid | Repel | Attraction | Uppercut de ferraille | Pilier de ferraille | Punk Gibson | Punk Corna Dio |
| X Drake | Estocades en rafale | Ruée du Drapeau rouge | Taille ascendante | Croix du Drapeau rouge | Morsure de l'allosaure | Charge de l'Allosaurus |
| Enel | Sango | Trident de Nonosama | Vari — 1 000 000 V | El Thor | Mamaragan | Amaru — Raijin |
| Rob Lucci | Rankyaku « Hyōbi » | Soru — Shigan | Shigan « Ōren » | Griffes du léopard | Rokuōgan | Rokuōgan — pleine puissance |
| Shanks | Onde tranchante du Haki | Gryphon — ruée | Estoc céleste | Haoshoku Haki | Kamusari | Haoshoku no Kenbu |
| Barbe Noire | Kurouzu | Gura Gura — poing du séisme | Uppercut des ténèbres | Black Hole | Liberation | Kaishin des ténèbres |
| Shiki | Kogarashi | Zan Sword | Kogarashi — croissant renversé | Fuwa Fuwa — rocher flottant | Shishi Odoshi | Shishi Odoshi : Chimaki |
| Aokiji | Ice Block — Partisan | Ice Time | Ice Block — Poing du givre | Ice Age | Ice Block — Pheasant Beak | Ice Time Capsule |
| Kizaru | Laser du doigt | Ama no Murakumo | Ama no Murakumo — ascension | Yata no Kagami | Yasakani no Magatama | Yata no Kagami — Kōsen |
| Akainu | Dai Funka | Meigo | Colonne éruptive | Éruption | Ryusei Kazan | Inugami Guren |

Sanji n'a pas de projectile : son [C] est une rafale de coups de pied à bout
portant. Le mode arcade enchaîne huit
combats, du plus abordable au plus coriace : six adversaires tirés au sort,
un par tranche du classement, puis Barbe Blanche et Akainu au bout (Barbe
Noire remplace celui des deux que l'on joue). L'ordinateur y monte en
difficulté à chaque combat.

Garder = reculer (accroupi pour les coups bas). Trop garder brise la garde.
Les dégâts diminuent au fil d'un combo, et un coup qui touche
l'adversaire en pleine attaque fait 20 % de dégâts en plus et l'étourdit plus
longtemps (« CONTRE ! »).

## Jouer en ligne

Dans **VERSUS J1 CONTRE J2**, choisir **EN LIGNE — CRÉER UN SALON** : le jeu
affiche un lien d'invitation (copié dans le presse-papiers) et un code de
6 lettres. L'adversaire ouvre le lien, ou choisit **EN LIGNE — REJOINDRE** et
tape le code. Chacun choisit son combattant, l'hôte choisit l'arène, puis
combat, revanche ou retour au menu.

Le salon reste ouvert tant que l'hôte est là : si l'adversaire s'en va (ou perd
la connexion), à n'importe quel moment, même en plein combat, l'hôte revient à
l'écran d'attente du salon, avec le même code et le même lien, et un autre
joueur peut le rejoindre. Si c'est l'hôte qui part, l'invité est prévenu et
revient au menu VERSUS.

Un spectateur (un seul par salon, pour ne pas charger la connexion de l'hôte)
peut suivre les combats en direct : l'hôte copie le **lien spectateur**
(`?spectateur=CODE`, touche A / ← sur l'écran du salon), ou le spectateur
choisit **REGARDER UN SALON** et tape le code. Il peut arriver à tout moment,
même en plein combat : l'hôte lui envoie les entrées confirmées des deux joueurs
depuis le début du match, son navigateur rejoue le combat et rattrape le direct.
Il n'envoie rien aux joueurs.

Les deux navigateurs se parlent directement (WebRTC). La mise en relation passe
par le service public PeerJS, sans serveur à héberger. Le netcode est à
rollback (délai d'entrée de 2 frames, retour arrière jusqu'à 8 frames), comme
les jeux de combat actuels. Sur les réseaux très fermés (certains réseaux
d'entreprise ou partages 4G), la connexion directe peut échouer : il faut alors
un relais TURN, à déclarer dans `VITE_ICE_SERVERS`.

Variables Vercel facultatives, pour un serveur de mise en relation à soi
(`npx peerjs --port $PORT --path /salon --proxied true`) : `VITE_PEER_HOST`,
`VITE_PEER_PORT`, `VITE_PEER_PATH`, `VITE_PEER_SECURE`, `VITE_ICE_SERVERS`
(JSON). En local : `npm run peer:local -w apps/web`, puis `?peer=127.0.0.1:9000`
dans l'URL ; `npm run e2e:online -w apps/web` joue un match complet entre deux
navigateurs avec latence et pertes simulées.

Relais TURN (indispensable entre deux réseaux différents : 4G, box, réseau
d'entreprise) : la fonction Vercel `apps/web/api/ice.js` fournit des
identifiants temporaires. Renseigner sur Vercel soit
`CLOUDFLARE_TURN_KEY_ID` + `CLOUDFLARE_TURN_API_TOKEN` (Cloudflare Realtime,
TURN), soit `METERED_TURN_DOMAIN` + `METERED_TURN_API_KEY` (Metered), puis
redéployer.

## Développement

| Commande | Effet |
| --- | --- |
| `npm run dev` | Serveur Vite |
| `npm run build` | Vérification des types et build de production dans `apps/web/dist` |
| `npm test` | Tests vitest : moteur, données et combos de chaque personnage, 30 matchs ordinateur contre ordinateur (chaque combattant, des deux côtés) |
| `npm run sprites` | Ré-extrait les sprites des planches (`python3`, `pillow`, `numpy`, `scipy`) |

Déploiement Vercel : *Root Directory* `apps/web`, le reste est dans
`apps/web/vercel.json` (Vite, sortie `dist`). Aucun serveur n'est nécessaire.

Voir `CLAUDE.md` pour l'architecture et `docs/ADDING_A_CHARACTER.md` pour
ajouter un combattant.

## Ressources graphiques

Les planches de sprites et les décors (`assets/`, et les fichiers qui en sont
extraits dans `apps/web/public/`) proviennent du jeu *One Piece: Gigant
Battle! 2 — New World* (Nintendo DS), via un rip publié sur
spritedatabase.net. Ils appartiennent à leurs ayants droit (Eiichiro Oda,
Shūeisha, Toei Animation, Bandai Namco), ne sont **pas** couverts par la
licence MIT de ce dépôt et ne servent qu'au prototype. Le code, lui, est sous
licence MIT.
