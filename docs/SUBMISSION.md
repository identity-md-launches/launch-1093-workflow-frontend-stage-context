# Submission integrity

The frontend delivery is confined to `web/`, `dist/`, and `docs/`. The only added dotfile is the specifically permitted `web/.gitignore`. Its patterns ignore generated dependency/cache directories recursively. No contract source, original implementation ABI, root build settings, root ignore rules, root lockfiles, `lib/`, `.github/`, or submodule entries are changed.

The final export contains six assets and its deployment manifest, totaling 568,527 bytes. Source, dependency lockfile, implementation-derived runtime ABI, all required runtime assets, design/validation documentation, and useful browser evidence are included. Node modules, caches, test scratch files, temporary tool output, and dependency archives are excluded.

Submission checks use:

```sh
git diff --cached --name-only
git diff --cached --check
git ls-files --stage
# After committing, measure a complete bundle, including reachable history:
git bundle create /tmp/swarm-brain-submission.bundle --all
git bundle verify /tmp/swarm-brain-submission.bundle
```

The workspace `.git` is mounted read-only: `git add` failed when creating `.git/index.lock`. Therefore these files could not be committed in this checkout. For the size/transport check, the worker cloned the unchanged base into ignored `test/scratch/submission-git`, copied only the allowed delivery paths, and created a local candidate commit there. That scratch checkout and bundle are verification scaffolding and are not submitted; the publisher must collect and commit the prepared source/export/evidence in the original workspace.

The worker additionally checks the bundle's actual byte size against the mandatory 8,388,608-byte limit and verifies that no staged/tracked delivery path includes generated dependency directories, caches, or a gitlink (submodule). The bundle is a local size/transport check in `/tmp`, not an extra submitted artifact or published repository.

**Result:** scope and whitespace checks passed for 47 delivery paths. The candidate bundle verified as a complete history, measured below 3 MiB, and passed the 8 MiB limit. No dependency archives, tracked generated directories, or gitlinks were present. Candidate checkout files matched the prepared workspace delivery byte for byte.

The final browser evidence is bound to the production manifest SHA-256 in `evidence/browser-results.json`; the asset verifier checks that manifest against all final exported bytes. After collecting and committing the prepared files, the publication service can host `dist/` without rebuilding. URLs/CIDs and post-publication checks are not worker completion prerequisites.
