Official Lighter WASM signer, built from https://github.com/elliottech/lighter-go
package ./wasm (the TypeScript + WASM quickstart signer), plus wasm_exec.js from
the same Go toolchain that produced the .wasm.

Source commit: 74e2b99
Toolchain: go version go1.27.3 linux/amd64
Do not replace wasm_exec.js with a file from a different Go version.
