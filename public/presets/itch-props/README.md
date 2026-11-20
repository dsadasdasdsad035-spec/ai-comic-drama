# itch 家具包（本地入库）

不调用 itch.io API；从 itch **免费区**下载 ZIP 后自行解压登记，许可以各包页面为准。

## 入库

```bash
node scripts/ingest-itch-prop-pack.mjs \
  --pack my-furniture-pack \
  --from ./downloads/unpacked \
  --main scene/chair.glb \
  --title "木椅" \
  --license "CC0" \
  --itch "https://作者.itch.io/包名"
```

校验：

```bash
npm run validate:itch-props
```

manifest 提交入库即可共享条目；模型文件在 `vendor/itch-props/`（默认 gitignore，大文件请自备或 CI 制品）。