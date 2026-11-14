import { Controller, Get, Inject } from '@nestjs/common';
import { PlansService, type PublicPlan } from './plans.service';

@Controller('v1/plans')
export class PlansController {
  constructor(@Inject(PlansService) private readonly plans: PlansService) {}

  @Get()
  async list(): Promise<{ plans: PublicPlan[] }> {
    return { plans: await this.plans.listPublic() };
  }
}
