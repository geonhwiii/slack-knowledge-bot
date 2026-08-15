/// <reference types="bun" />

// `bun:test`과 `import.meta.dir`의 타입을 tsc에 알린다.
//
// @types/bun은 bun-types를 가리키는 한 줄짜리 shim이라 자동 포함만으로는 tsc가
// 집어가지 못한다. tsconfig의 `types` 배열로 지정하면 @types/node·react까지 전부
// 손으로 나열해야 해서, 참조 한 줄만 두는 편이 덜 깨진다.
