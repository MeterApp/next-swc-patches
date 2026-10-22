import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const project = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const reviewedNext = "16.4.2";
const reviewedBinding = "https://github.com/MeterApp/next-swc-patches/releases/download/next-16.4.2-loader-roots-r1/next-swc-darwin-arm64.tgz";
const rootNext = project.dependencies?.next;
const rootBinding = project.optionalDependencies?.["@next/swc-darwin-arm64"];

/** Fail back to the supported project layout when the reviewed version changes. */
export function selectVirtualStoreType({ platform, arch, ci, nextVersion = rootNext, nativeBinding = rootBinding }) {
  return platform === "darwin" && arch === "arm64" && !ci && nextVersion === reviewedNext && nativeBinding === reviewedBinding
    ? "global"
    : "project";
}

/**
 * pnpm 12 writes JSON metadata; paths are relative to node_modules.
 * @returns {Record<string, {path: string}>}
 */
export function additionalRootsFromModulesMetadata(root, metadata) {
  if (typeof metadata.virtualStoreDir !== "string") throw new Error("pnpm virtual store metadata is missing; run pnpm deps:install.");
  const store = resolve(root, "node_modules", metadata.virtualStoreDir);
  const fromProject = relative(root, store);
  // Project layouts already live inside the root and must not overlap an additional root.
  return fromProject === ".." || fromProject.startsWith(`..${sep}`) || isAbsolute(fromProject)
    ? { pnpm: { path: store } }
    : {};
}

export function turbopackAdditionalRoots() {
  const metadata = JSON.parse(readFileSync(new URL("./node_modules/.modules.yaml", import.meta.url), "utf8"));
  return additionalRootsFromModulesMetadata(projectRoot, metadata);
}

export const hooks = {
  // Trust only the reviewed root dependency, retaining the exotic-subdependency guard.
  readPackage(manifest) {
    if (rootNext === reviewedNext && rootBinding === reviewedBinding && manifest.name === "next" && manifest.version === reviewedNext) {
      const optionalDependencies = { ...manifest.optionalDependencies };
      delete optionalDependencies["@next/swc-darwin-arm64"];
      return {
        ...manifest,
        optionalDependencies,
        peerDependencies: { ...manifest.peerDependencies, "@next/swc-darwin-arm64": reviewedNext },
        peerDependenciesMeta: { ...manifest.peerDependenciesMeta, "@next/swc-darwin-arm64": { optional: true } },
      };
    }
    return manifest;
  },
  updateConfig(config) {
    return {
      ...config,
      virtualStoreType: selectVirtualStoreType({ platform: process.platform, arch: process.arch, ci: process.env.CI }),
    };
  },
};
