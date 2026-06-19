let storeDir = process.env.RESEARCH_STORE_DIR || './data/research';

export function getResearchStoreDir(): string {
  return storeDir;
}

export function setResearchStoreDirForTests(value: string): void {
  storeDir = value;
}
