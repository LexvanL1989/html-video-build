# HTML video build

Manual reproducible builds of an authored HTML animation using HyperFrames 0.8.185, Chromium and FFmpeg on a standard GitHub-hosted Ubuntu runner.

Only generic tooling and AES-256-GCM encrypted project data live in this repository. The 256-bit key is stored as an Actions secret. Decrypted sources, media, snapshots and logs remain inside the ephemeral runner. Build results are encrypted before returning through a dedicated result branch. No Actions artifact storage, dependency cache, LFS, paid renderer or generation API is used.

The workflow has two sequential manual phases: review, then render. A render verifies source SHA256 fingerprints, starts and stops the editable preview, checks the video contract, decodes the full video, measures audio loudness, and creates decoded-frame review images. A human or agent must still inspect those images.

Standard runners in public repositories are free: https://docs.github.com/en/billing/concepts/product-billing/github-actions

Do not run this workflow with untrusted source packages or pull-request code. Do not print decrypted content or the key. There are no scheduled or pull-request triggers. Do not publish the result as an unencrypted public artifact without the owner's permission.
