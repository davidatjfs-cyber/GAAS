# 餐厅增长 AI 服务（GaaS）

这是一套面向餐饮老板、连锁品牌和投资人的咨询式产品发布 PPT。

目录包含：

- `preview/index.html`：演示预览页
- `data.mjs`：24 页统一内容模型
- `assets/`：真实系统截图与逐页导出的页面图片
- `outputs/restaurant-growth-ai-service-gaas.pptx`：可直接外发的成品 PPTX
- `build-presentation.mjs`：一键重新生成脚本

运行：

```bash
node build-presentation.mjs
```

脚本会先启动本地预览服务，再逐页导出并合成 PPTX。
