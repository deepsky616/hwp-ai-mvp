import { defineConfig } from "vitest/config";

export default defineConfig({
  // React 컴포넌트 테스트에서 classic runtime(React.createElement) 대신
  // automatic JSX runtime을 쓰도록 해, 각 파일에 React를 import하지 않아도 되게 한다.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
  },
});
