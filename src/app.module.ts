import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WordleSolverService } from './services/daily.service';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [
    AppService,
    WordleSolverService,
  ],
})
export class AppModule {}
