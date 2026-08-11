import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;

// 将 manifest.json 的版本号更新为目标版本
let manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));

// 在 versions.json 中登记版本兼容映射
let versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t"));
