import * as fs from 'fs';
import * as path from 'path';

export function isPathInside(filePath: string, directoryPath: string): boolean {
  const relative = path.relative(path.resolve(directoryPath), path.resolve(filePath));
  return relative === '' || (Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative));
}

export function isExistingRealPathInside(filePath: string, directoryPath: string): boolean {
  const realDirectory = fs.realpathSync(directoryPath);
  const realPath = fs.realpathSync(filePath);
  return isPathInside(realPath, realDirectory);
}
