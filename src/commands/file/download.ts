import axios from 'axios';
import * as fs from 'fs';
import { pipeline } from 'stream/promises';

/**
 * Save a signed address to a local file. The address already carries its own authorization, so no API key is sent;
 * only https is followed. By default the file is created exclusively: an existing one is never touched, and a
 * partial file this call created is removed when the transfer fails. With {@code force} the bytes go to a side file
 * first and replace the target only once complete, so a broken transfer leaves the old file as it was.
 */
export async function saveUrlTo(url: string, dest: string, force = false): Promise<number> {
  if (!/^https:\/\//i.test(url)) throw new Error('下载地址不是 https，已拒绝');
  // exclusive create first: if the file already exists this throws before anything could be cleaned up
  const target = force ? `${dest}.part-${process.pid}` : dest;
  const fd = fs.openSync(target, 'wx');
  try {
    const response = await axios.get(url, { responseType: 'stream', maxRedirects: 3, timeout: 10 * 60 * 1000 });
    await pipeline(response.data, fs.createWriteStream(target, { fd, autoClose: true }));
    if (force) fs.renameSync(target, dest);
  } catch (error) {
    fs.rmSync(target, { force: true });
    throw error;
  }
  return fs.statSync(dest).size;
}
