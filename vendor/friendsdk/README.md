# Vendored FriendSDK modules

Copied unmodified from `@rarefriends/friendsdk` v0.1.2 (`dist/`), Apache-2.0 (see `LICENSE`, `NOTICE.md`).

- `friend-world.js` + `friend-worlds.json` — isometric world presets and renderer (Rare Friends Isometric World Assets, see `provenance.json`)
- `movement.js`, `friend-navigation.js` — walkable-ground movement and path finding

Character artwork is not bundled: Friendpad reads canonical Generations sprites on-chain from the FriendSDK sprite registry (`0x246E3E9730A7Eade94c79be0Fd78d210f89AEb8D`), exactly like the SDK's `generation-sprites` reader.
