export function greet(name: string): string {
  const target = name.trim() === "" ? "World" : name;
  return `Hello, ${target}!`;
}
