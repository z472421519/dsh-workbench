# dsh-forest-theme

把 [pi](https://pi.dev) 的 forest 森林绿主题搬到 DeepSeek Harness（DSH）的 Web GUI。

- 浅色与深色各一套，分别对应 pi 的 `forest-light` / `forest-dark`。
- 色值不手写：`scripts/gen-palette.mjs` 直接调用你的 pi 主题生成器
  （`~/Work/agent/pi-forest-theme/lib/palette.mjs`）与 `forest-tuning.json`，
  把 OKHSL 规格解成 hex，再映射到 DSH 的 `--dsw-*` token。
- 只叠加颜色 token（`ctx.theme.overrideTokens`），不动字号、字体、背景图、图标，
  也不写用户设置；关闭插件即恢复 DSH 原生配色。
- **画布透明 + 玻璃面板**：`--dsw-alias-bg-base` 为 `transparent`，抬升面（层 1/2、
  侧栏 62%、菜单 92%、气泡 82%、代码块 78%）是半透明森林玻璃，窗口底色
  由插件写在 `<html>` 上（`#f0f1f0` / `#1c221d`）。装了壁纸时壁纸透出；没装时看到
  森林底色，不会空白。
- **输入框用森林绿玻璃**：`--dsw-specific-input-major` 取色板的浅绿（`rgba(221,233,221,0.90)`）
  而不是中性白。中性白玻璃在森林界面里像一块空白纸，绿色让它归属主题；深色对应
  `rgba(32,46,35,0.90)`。登录输入框共用同一档。
- **正文区不覆盖**：聊天流保持完全透明，文字直接落在壁纸上，壁纸质感完整保留。
  代价是正文的对比度取决于壁纸本身——深色文字在浅色壁纸上约 3.9:1，在深色壁纸上
  会明显不够。想要可读性时把 `GLASS` 里的值调高或改用 `MODE = 'solid'`。

## 为什么用 overrideTokens 而不是 register

`ctx.theme.register()` 注册的是**可选主题**，用户要再去外观里选一次；
`overrideTokens()` 是**叠加层**，装上就生效，并保留用户原本的
`light` / `dark` / `system` 偏好——DSH 决定用哪套，本插件只提供那套的森林色值。
卸载时该层被移除，被覆盖的 token 自动回到原生值。

## 装完怎么确认生效

插件**没有**设置项，也**不会**在「设置 → 通用 → 外观」里新增主题选项——那里永远是
浅色/深色/跟随系统三项。确认方式：

1. 画布变成森林绿，切到浅色和深色各看一次，两套都应是森林色系。
2. 打开开发者工具控制台，应有一行
   `[forest-theme] stacked 145 tokens · theme revision N`。若这行在、颜色却不对，
   说明有另一个插件覆盖了同一批 token（见下面的共存说明）。

刷新页面时会有一次从 DSH 启动色到森林绿的闪变，这是叠加层方案的固有行为：token
层要等客户端模块加载后才生效。

## 与壁纸插件共存

画布已经是透明的，所以壁纸插件透出背景的那一半机制不再冲突。仍然要注意：

- 壁纸插件会把 `--dsw-alias-bg-layer-1/2`、`--dsw-specific-sidebar-fill` 也设为半透明，
  和本插件的玻璃层是**同一批 token**。两者顺序按 `overrideTokens` 调用先后决定，
  后建的层占上风，且壁纸插件每次改设置都会重新建层、重新置顶。
- 结果是：壁纸插件的配色（classic / azureRose / violetTeal / amberRose）会盖掉森林
  的文字与强调色，而玻璃结构保持。若你只要壁纸透出、颜色仍用森林，**只装本插件**，
  用系统壁纸或其它不写 token 的图片层即可。

## 切换回实色模式

`scripts/gen-palette.mjs` 里的 `MODE` 常量控制表面模式：

- `'wallpaper'`（当前）：画布透明 + 玻璃表面
- `'solid'`：同样的森林底色与画布透明，但所有表面不透明

两个模式都保留 `<html>` 底色，所以都能在没有壁纸时正常显示。

```bash
# 改完 MODE 后
npm run gen
```

## 安装

```bash
dsh plugin --profile desktop add link:"$PWD"
```

或在本机 DSH 的「插件 → 添加插件」里选择这个目录。

## 重新生成

```bash
npm install          # 只有 okhsl 一个依赖，生成期用
npm run gen          # 重写 src/palette.js 与 client.js
```

改色相或饱和度不用碰这里：改
`~/Work/agent/pi-forest-theme/forest-tuning.json` 里的 `hue` / `saturation`，
再跑一次 `npm run gen`，两个应用就同步了。pi 主题不在默认位置时用环境变量指定：

```bash
PI_FOREST_DIR=/path/to/pi-forest-theme npm run gen
```

`client.js` 是整文件生成的。若你手工改过它，在文件里留一个 `@hand-edited`
标记，生成器会拒绝覆盖并提示你先把改动挪回 `scripts/gen-palette.mjs`。

## 映射

`src/palette.js` 里的 `MAP` 是唯一的对照表：左边 DSH token，右边森林语义角色。
新增 DSH 表面或新的森林角色时改这里再生成；生成器会在角色缺失时报错，不会静默留空。

## 已知限制

- 只覆盖 `--dsw-alias-*` / `--dsw-specific-*` / `--dsw-menu-*` 这三类别名 token。
  画在 CSS 里的定值（例如少数插画与 `--dsw-static-*` 原始色阶）不跟随本主题。
- macOS 桌面的侧栏有系统 vibrancy 玻璃底色，森林色会与它混合，显色比网页版略浅。
- 与其它修改同一批 token 的插件（壁纸类、外观类）叠加时，后加载的覆盖先加载的：
  `ctx.theme.overrideTokens()` 按调用顺序叠层，后来的同一 token 获胜。本插件在
  profile 里排在 `dsh-wallpaper-bg` 之后，因此两套配色同时启用时森林色优先；
  而壁纸插件在设置变化时会再次调用，那一瞬间会短暂反过来。同一批颜色不要同时开两个。
- 边框（`--dsw-alias-border-l1..l4`）、骨架屏和浮层（tooltip / toast / hovercard）
  不是取森林的实色，而是保留 DSH 原本的透明度/深底语义、只换色相——否则四级边框
  会塌成同一块实色，浅色主题下的 tooltip 会变成普通卡片。
- **正文可读性不在本插件保证范围内**。聊天流不覆盖表面，文字直接压在壁纸上；浅色
  壁纸配深色文字约 3.9:1，浅色壁纸配浅色文字或深色壁纸配深色文字会更低。需要正文
  清晰时换一张与主题明暗相反的壁纸，或改用 `MODE = 'solid'`。

## 对比度

生成后实测（WCAG 相对亮度）。带透明度的组合是把 rgba 叠到画布色上合成后计算的：

| 组合 | 浅色 | 深色 |
|---|---:|---:|
| 主文本 / 画布 | 8.94 | 12.92 |
| 次文本 / 画布 | 5.27 | 6.70 |
| 主文本 / 侧栏 | 8.50 | 9.72 |
| 次文本 / 代码块 | 5.02 | 5.04 |
| 白字 / 品牌按钮 | 4.89 | 7.39 |
| 提示文本 / 画布 | 3.65 | 7.15 |
| 警告标签 / 警告底色 | 6.75 | 5.24 |
| diff 增行文字 / 底色 | 4.78 | 4.90 |
| diff 删行文字 / 底色 | 4.62 | 4.47 |
| toast 操作 / toast 底 | 6.53 | 7.32 |

另外按真实壁纸（采样 `#9da2a4`）复算玻璃层叠加后的对比度。注意正文区不在下表里：
它保持透明，对比度由壁纸决定，实测主文本约 3.92。

| 表面 | 主文本 | 次文本 | 提示文本 |
|---|---:|---:|---:|
| 输入框 90%（森林绿） | 7.59 | 4.48 | — |
| 用户气泡 82% | 7.18 | — | — |
| 侧栏 62% | 6.50 | — | — |


带透明度的行（警告底色、diff 底色）是把 rgba 叠在画布色上合成后算的，不是对原值直接算。
「提示文本」按 WCAG 当作小号辅助文字，3.65 / 7.15 接近 DSH 原生（3.71 / 8.54），
在 AA-large 范围内；其余全部 ≥ 4.5。

## 许可

配色规格来自本机 `pi-forest-theme`（作者自有）。`okhsl` 转换库为 MIT，
版权归 Jaid、Brian Holbrook、Björn Ottosson，仅生成期使用，不随包分发。
