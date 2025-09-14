import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { WordleSolverService } from './services/daily.service';

@Controller()
export class AppController {
  constructor(
    private appService: AppService,
    private wordleSolverService: WordleSolverService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('/play/daily')
  async playGameDaily() {
    return await this.wordleSolverService.solve();
  }

  @Get('/smart/play/daily')
  async playSmartGameDaily() {
    return await this.wordleSolverService.solveOptimized();
  }
}
