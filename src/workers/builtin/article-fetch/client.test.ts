import assert from 'node:assert/strict';
import test from 'node:test';
import { extractReadableArticleText } from './client';

test('extractReadableArticleText prefers JSON-LD articleBody over navigation chrome', () => {
  const html = `
    <html>
      <body>
        <nav>Markets Business Subscribe Sign in Search</nav>
        <main>
          <article>
            <h1>Navigation-heavy page</h1>
            <p>Markets</p><p>Business</p><p>Subscribe now</p>
          </article>
        </main>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "NewsArticle",
            "articleBody": "Apple reported stronger services revenue and said gross margins improved because enterprise demand stayed resilient. Management also raised capital return plans and described supply constraints easing into the next quarter."
          }
        </script>
      </body>
    </html>`;

  const text = extractReadableArticleText(html);
  assert.match(text, /stronger services revenue/);
  assert.doesNotMatch(text, /Subscribe Sign in Search/);
});

test('extractReadableArticleText scores readable content containers above menus', () => {
  const html = `
    <html>
      <body>
        <main>
          <div class="top-menu">Home Markets Business Technology Opinion Subscribe Login</div>
          <div class="article-body">
            <p>Nvidia shares moved after the company said cloud demand for its latest accelerators remained above supply.</p>
            <p>The report also said management expects data-center revenue to keep growing as customers expand AI infrastructure budgets.</p>
          </div>
        </main>
      </body>
    </html>`;

  const text = extractReadableArticleText(html);
  assert.match(text, /cloud demand/);
  assert.match(text, /data-center revenue/);
  assert.doesNotMatch(text, /Home Markets Business/);
});
