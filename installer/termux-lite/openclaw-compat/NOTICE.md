OpenClaw Android compatibility files
====================================

This directory includes compatibility logic adapted from:

https://github.com/AidanPark/openclaw-android

The source project is MIT licensed. Its license text is reproduced below for
the adapted files in this directory:

Copyright (c) 2026 OpenClaw on Android Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Only the minimal files needed by the ClawMobile Termux runtime bootstrap are kept
here:

- `glibc-compat.js`
- `patch-openclaw-paths.sh`
- `systemctl`

ClawMobile uses these files to run OpenClaw directly in Termux through the
Termux `glibc-runner` dynamic linker and the official Linux arm64 Node.js
binary, without cloning the upstream installer at install time.
