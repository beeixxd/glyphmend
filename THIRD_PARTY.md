# 第三方组件（已随包放入 dist/vendor，可完全离线运行）

| 组件 | 版本 | 许可 | 位置 |
|---|---|---|---|
| tesseract.js（含 worker） | 7.0.0 | Apache-2.0 | dist/vendor/tesseract |
| tesseract.js-core（WASM，LSTM 内核） | 7.0.0 | Apache-2.0 | dist/vendor/tesseract/core |
| Tesseract 语言数据 eng / chi_sim（best_int） | npm @tesseract.js-data 1.0.0 | npm 包标注 MIT；底层 tessdata 为 Apache-2.0 | dist/vendor/tesseract/lang |
| onnxruntime-web（WASM 后端） | 1.30.0 | MIT | dist/vendor/ort |
| PP-OCRv4 检测 / 识别模型与字典（PaddleOCR） | 随 @gutenye/ocr-models 1.4.2 | 包 MIT；模型来自 PaddleOCR（Apache-2.0） | dist/vendor/paddle |

在线功能（按需、非内置）：Google Fonts / GitHub 上 google/fonts 仓库的免费字体（各字体自带 OFL / Apache / UFL 授权），
Photopea 免费在线编辑器（第三方服务，遵循其使用条款），以及你自行配置的视觉大模型服务商。
商用字体、定制字体不在免费库内。
