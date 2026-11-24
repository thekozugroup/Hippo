// Where "put your own Hippo online" starts. One place, so a fork can point these at itself.
//
// The deploy link opens Vercel's project creation page. Vercel makes a copy of the repository in the
// visitor's own GitHub account and puts it online (https://vercel.com/docs/deploy-button/source).
// The README's "Deploy with Vercel" button carries the same address; hosting.test.ts checks that.

/** The Hippo project whose copy people put online. A fork changes this one line. */
export const UPSTREAM_REPO_URL = 'https://github.com/thekozugroup/Hippo'

/** Default names for the visitor's copy. Vercel may change them when a name is taken. */
const COPY_NAME = 'hippo'

/** Vercel's page that makes a copy of the project in the visitor's account and puts it online. */
export const DEPLOY_URL = `https://vercel.com/new/clone?repository-url=${encodeURIComponent(UPSTREAM_REPO_URL)}&project-name=${COPY_NAME}&repository-name=${COPY_NAME}`

/** The step by step guide, for people who want to read before they start. */
export const HOSTING_GUIDE_URL = `${UPSTREAM_REPO_URL}#run-your-own-copy`
