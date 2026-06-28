# Terrestria

## Play multiplayer

Host a server on your machine and have others join over the network with a
6-character game code:

```bash
npm install
npm start          # serves the game on http://<your-ip>:8787
```

The host clicks **Host a new game** to get a code; everyone else opens the same
address, enters the code, and joins. Idle games are cleared after 10 minutes
(configurable). Full setup, configuration, architecture, and the AWS
(DynamoDB + Lambda + API Gateway) migration plan are in
[MULTIPLAYER.md](./MULTIPLAYER.md).

Other scripts: `npm test` (engine + lobby tests), `npm run demo` (a scripted
bot-vs-bot game), `npm run dev` (client with hot reload + `npm run server`).

## Lore
It is the 25th century, the fleet began as a single effort for humanity to band together after the recent Sol War devastated humanities home system. Only 7 planets remain as Mercury was pushed into the Sun. Somewhere between the stars, factions formed on the ships and the collective mission dissolved. Political extremism spread like wildfire and many ships opened fire on one another. The only surviving ships are those that are not within range of each other. These ships raced towards the same system, societies redeveloping in completed isolation decade after decade. The only contact with another ship were salvage missions sent to the shattered hulls of nearby ships that had melted open from your microwave beam, once used to communicate with Sol, now a weapon of war. The time has come now, nearly a century later, for war. Build up planetary infrastructure, form alliances, and wage war with other colonies.
