// wrangler.toml's [[rules]] Text entry imports .sql files as strings.
declare module '*.sql' {
  const text: string;
  export default text;
}
