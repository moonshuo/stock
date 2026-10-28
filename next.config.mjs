/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "standalone",
  // DuckDB is a native server dependency and must be copied into the
  // standalone runtime instead of being resolved from a build-machine path.
  serverExternalPackages: ["duckdb"],
  outputFileTracingIncludes: {
    "/api/daily-market": ["./node_modules/duckdb/**/*"],
  },
  // 开发热更新与生产构建使用独立缓存，避免 build 覆盖正在运行的开发服务器。
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next"
};

export default nextConfig;
