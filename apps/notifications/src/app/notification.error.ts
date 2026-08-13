export class NotificationError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
  ) {
    super(message)
  }
}
