#!/bin/bash
# Vercel Ignored Build Step: exit 0 = skip, exit 1 = build
# Triggers build when: blog-site/ changes OR non-docs app code changes

# Always build production (main branch)
[ "$VERCEL_GIT_COMMIT_REF" = "main" ] && exit 1

# Skip preview deploys that aren't tied to a pull request
[ -z "$VERCEL_GIT_PULL_REQUEST_ID" ] && exit 0

[ -z "$VERCEL_GIT_PREVIOUS_SHA" ] && exit 1
git cat-file -e "$VERCEL_GIT_PREVIOUS_SHA" 2>/dev/null || exit 1
git diff --name-only "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- 'blog-site/' | grep -q . && exit 1
git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- ':!*.md' ':!.planning' ':!docs/' ':!e2e/' ':!scripts/' ':!.github/'
