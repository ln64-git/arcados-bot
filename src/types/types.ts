export interface Command {
  data: any;
  execute: (interaction: any) => Promise<void>;
}
