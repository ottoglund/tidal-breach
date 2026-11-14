# MakeHuman source assets (CC0 1.0)

Fetched on 2026-11-13 from the MakeHuman community repository (`master` branch),
base URL `https://raw.githubusercontent.com/makehumancommunity/makehuman/master/`.
Only asset files are used; nothing from the MakeHuman program source (AGPL) is copied or run.

Authors / copyright holders at the time of the CC0 release (named in each file header):
Data Collection AB, Joel Palmius, Jonas Hauquier (MakeHuman team). Licence: CC0 1.0 Universal
(`LICENSE.ASSETS.md`; `LICENSE.makehuman.md` is the repository's licence overview stating that the base mesh,
targets, rigs, weights, textures and proxies are CC0 while the program code is AGPL).

| Local file | Source path (relative to the base URL) | SHA-256 |
|---|---|---|
| `base.obj` | `makehuman/data/3dobjs/base.obj` | 8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c |
| `default.mhskel` | `makehuman/data/rigs/default.mhskel` | 99f179bce0aa850b45d4191a1d0d234c5851f881c057439470ded3bddf729a24 |
| `default_weights.mhw` | `makehuman/data/rigs/default_weights.mhw` | 0f3641d651ae3d00ad6b4ccee43142edb109d3bd909d27d9e4139ef1beed8625 |
| `targets/caucasian-male-young.target` | `makehuman/data/targets/macrodetails/caucasian-male-young.target` | 70e228ba7164737dae664454394536fc5935fa48d333c1a97d77e2dc6eacc5f5 |
| `targets/universal-male-young-maxmuscle-averageweight.target` | `makehuman/data/targets/macrodetails/universal-male-young-maxmuscle-averageweight.target` | c171ff9cc95e96273beb3e3b1969a01988c2d4982ebc6fe04bf81cf72ee3b295 |
| `targets/universal-male-young-averagemuscle-minweight.target` | `makehuman/data/targets/macrodetails/universal-male-young-averagemuscle-minweight.target` | fac0d53b7051f4d1f06230d0b419e916eb5bae5ce67c031a9998fdde05229755 |
| `targets/universal-male-young-maxmuscle-minweight.target` | `makehuman/data/targets/macrodetails/universal-male-young-maxmuscle-minweight.target` | 5873f11edc96fde72a79ec35fa1d292a6a1a594b5eadfd82d59faf48834561de |
| `targets/male-young-averagemuscle-averageweight-idealproportions.target` | `makehuman/data/targets/macrodetails/proportions/male-young-averagemuscle-averageweight-idealproportions.target` | 7bbd790604c908417ff8ca11e566e3577508d92a4f397a2ace0f89f4cc3aa373 |
| `targets/male-young-averagemuscle-minweight-idealproportions.target` | `makehuman/data/targets/macrodetails/proportions/male-young-averagemuscle-minweight-idealproportions.target` | 278060f8fb9c1843df0ae0894d015c8459ccb8cef74cf4f65032bae9152cfd6a |
| `targets/male-young-maxmuscle-averageweight-idealproportions.target` | `makehuman/data/targets/macrodetails/proportions/male-young-maxmuscle-averageweight-idealproportions.target` | d9452857903d18a2100ca26105d5a61083e7064fbe16f035863446728755ec20 |
| `targets/male-young-maxmuscle-minweight-idealproportions.target` | `makehuman/data/targets/macrodetails/proportions/male-young-maxmuscle-minweight-idealproportions.target` | d9452857903d18a2100ca26105d5a61083e7064fbe16f035863446728755ec20 |
| `poseunits/face-poseunits.bvh` | `makehuman/data/poseunits/face-poseunits.bvh` | 42a8e69692e30010371ee6993a6e5d3b468d35065559ec0953c936e31b8d903f |
| `poseunits/face-poseunits.json` | `makehuman/data/poseunits/face-poseunits.json` | e7224f76e9610049b79e5f9e8ac2985d1e9a367333395c07537919258cb42cc3 |
| `LICENSE.ASSETS.md` | `LICENSE.ASSETS.md` | f6089cba01cb570a24712b41ab8a586ccd3cc5ef53dc266ca50b95c288956d2c |
| `LICENSE.makehuman.md` | `LICENSE.md` | edd99571ca62698f78c943fd4fffb159a413c315fa0d4819d3cec5cadaf8b4f1 |

The two `poseunits/` files (fetched 2026-11-14; the JSON names the 60 frames of the BVH and states `"license": "CC0"`,
`"copyright": "(c) 2020 Data Collection AB, Joel Palmius, Jonas Hauquier"`) are MakeHuman's standard face pose units
(expression building blocks for the default skeleton's face bones). They are not shipped to the game: `tools/mh/poseunits.py`
reads them to get the rotation sizes of the lids, eyes and jaw used by the soldiers' face animation (game/src/enemies.js).
The teeth helpers (`helper-upper-teeth`, `helper-lower-teeth`) and the face bones' weights come from the `base.obj` /
`default_weights.mhw` already listed above.

`fetch_sources.sh` downloads the same files again and checks these hashes. The game itself never contacts
these hosts: it only loads the built `game/assets/models/soldier_body.bin` and `game/assets/models/viewmodel_arms.bin`
(`tools/mh/build_arms.py`, same source files) from its own origin.
