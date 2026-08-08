# 蹭饭图

纯前端的可交互蹭饭图。

[Live demo](https://23g1c15.sszx.tech/)

## 特点

- 支持缩放地图，根据缩放倍率显示不同层级。
- 地区可点击，点击后显示地区详细信息。
- 同学姓名可点击，点击后显示同学详细信息，如联系方式（上述 Live demo 原始数据无联系方式，故没有显示）。
- 学校卡片自动排列，支持拖拽。
- 支持搜索姓名缩写、大学、省份和城市并高亮匹配结果。
- 亮暗主题、显示范围、信息显示粒度、背景图片卡片重排时机、等均可个性化设置。
- 支持导出为 PNG，导出前可以设置导出尺寸、设置字号、拖拽卡片、添加图片等。

## 使用方法

1. 克隆本仓库并安装依赖。

    ```bash
    git clone https://github.com/788009/cft.git
    cd cft
    pnpm install
    ```

2. 使用 [cft-data-prepare](https://github.com/788009/cft-data-prepare) 基于实际数据生成 `data/` 文件夹并替换现有的 `data/` 文件夹。
3. 修改 `src/config.ts` 中的配置。
4. `pnpm dev` 启动开发服务，`pnpm build` 构建，`pnpm preview` 预览。
5. 可部署到 Cloudflare, Vercel, Netflix 等平台。

## 许可证

MIT License
