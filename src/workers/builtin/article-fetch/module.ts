import type { BackendWorkerModule } from '../../module';
import { articleFetchWorker } from './manifest';

export const articleFetchModule: BackendWorkerModule = {
  manifest: articleFetchWorker,
};

export { fetchArticle, type ArticleExtraction, type FetchArticleOptions } from './client';
