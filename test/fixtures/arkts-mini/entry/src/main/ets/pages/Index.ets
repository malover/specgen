import { sharedGreeting } from '../../../../../shared/src/main/ets/Helper'

@Entry
@Component
struct Index {
  @State message: string = 'Hello';

  build() {
    Column() {
      Text(this.message)
    }
  }
}

export function greeting(name: string): string {
  return sharedGreeting(formatGreeting(name))
}

function formatGreeting(name: string): string {
  return `Hello ${name}`
}
