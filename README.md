# 蹭饭图

纯前端的可交互蹭饭图。

[Live demo](https://23g1c15.sszx.tech/)

## 使用方法

1. 克隆本仓库并安装依赖。

    ```bash
    git clone https://github.com/788009/cft.git
    cd cft
    pnpm install
    ```

2. 使用 [cft-data-prepare](https://github.com/788009/cft-data-prepare) 生成 `data/` 文件夹并替换现有的 `data/` 文件夹。
3. 修改 `src/config.ts` 中的配置。
4. `pnpm dev` 启动开发服务，`pnpm build` 构建，`pnpm preview` 预览。
5. 可部署到 Cloudflare, Vercel, Netflix 等平台。

## 许可证

MIT License
