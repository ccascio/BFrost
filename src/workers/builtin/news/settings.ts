let storeDir = process.env.NEWS_STORE_DIR || './data/news';

export function getNewsStoreDir(): string {
  return storeDir;
}

export function setNewsStoreDirForTests(value: string): void {
  storeDir = value;
}
