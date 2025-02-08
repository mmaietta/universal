import { readFilesystemSync } from '@electron/asar/lib/disk';
import { Filesystem } from '@electron/asar/lib/filesystem';
import { spawn } from '@malept/cross-spawn-promise';
import fs, { Dirent } from 'fs-extra';
import path from 'path';

export const verifyAllAsars = async (
  appPath: string,
  additionalVerifications?: (asarFilesystem: Filesystem) => Promise<void>,
) => {
  const resourcesDir = path.resolve(appPath, 'Contents', 'Resources');
  const asars = (await fs.readdir(resourcesDir)).filter((p) => p.endsWith('.asar'));
  // sort for consistent result
  for await (const asar of asars.sort()) {
    await verifySmartUnpack(path.resolve(resourcesDir, asar), additionalVerifications);
  }
};

export const verifySmartUnpack = async (
  asarPath: string,
  additionalVerifications?: (asarFilesystem: Filesystem) => Promise<void>,
) => {
  const asarFs = readFilesystemSync(asarPath);

  // for verifying additional files within the Asar Filesystem
  await additionalVerifications?.(asarFs);

  // verify header
  expect(removeUnstableProperties(asarFs.getHeader())).toMatchSnapshot();

  const unpackedDirPath = `${asarPath}.unpacked`;
  if (!fs.existsSync(unpackedDirPath)) {
    return;
  }
  const files = (await walk(unpackedDirPath)).map((it: string) => {
    const name = toSystemIndependentPath(it.substring(unpackedDirPath.length + 1));
    if (it.endsWith('.txt') || it.endsWith('.json')) {
      return { name, content: fs.readFileSync(it, 'utf-8') };
    }
    return name;
  });
  expect(files).toMatchSnapshot();
};

export async function ensureUniversal(app: string) {
  const exe = path.resolve(app, 'Contents', 'MacOS', 'Electron');
  const result = await spawn(exe);
  expect(result).toContain('arm64');
  const result2 = await spawn('arch', ['-x86_64', exe]);
  expect(result2).toContain('x64');
}

// returns a list of all directories, files, and symlinks. Automates verifying Resources dir (both unpacked and packed)
export const walk = (root: string): string[] => {
  const getPaths = (filepath: string, filter: (stat: Dirent) => boolean) =>
    fs
      .readdirSync(filepath, { withFileTypes: true })
      .filter((dirent) => filter(dirent))
      .map(({ name }) => path.join(filepath, name));

  const dirs = getPaths(root, (dirent) => dirent.isDirectory());
  const files = dirs.map((dir) => walk(dir)).flat();
  return files.concat(
    dirs,
    getPaths(root, (dirent) => dirent.isFile() || dirent.isSymbolicLink()),
  );
};

export function toSystemIndependentPath(s: string): string {
  return path.sep === '/' ? s : s.replace(/\\/g, '/');
}

export function removeUnstableProperties(data: any) {
  return JSON.parse(
    JSON.stringify(data, (name, value) => {
      if (name === 'offset') {
        return undefined;
      }
      return value;
    }),
  );
}
