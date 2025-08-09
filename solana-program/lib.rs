use anchor_lang::prelude::*;

declare_id!("3iPDSAx7WGTBB6bvtviT3dUFkavMUcMo2aHYuNpuLxj4");

#[program]
pub mod blokoyunu_stats {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let game_stats = &mut ctx.accounts.game_stats;
        game_stats.total_blocks_mined = 0;
        game_stats.active_players = 0;
        game_stats.grid_expansions = 0;
        game_stats.longest_streak = 0;
        game_stats.authority = ctx.accounts.authority.key();
        
        msg!("Game stats initialized!");
        Ok(())
    }

    pub fn increment_blocks_mined(ctx: Context<UpdateStats>, amount: u64) -> Result<()> {
        let game_stats = &mut ctx.accounts.game_stats;
        game_stats.total_blocks_mined = game_stats.total_blocks_mined.checked_add(amount).unwrap();
        
        msg!("Blocks mined increased by {}, total: {}", amount, game_stats.total_blocks_mined);
        Ok(())
    }

    pub fn update_player_count(ctx: Context<UpdateStats>, new_count: u64) -> Result<()> {
        let game_stats = &mut ctx.accounts.game_stats;
        game_stats.active_players = new_count;
        
        msg!("Active players updated to: {}", new_count);
        Ok(())
    }

    pub fn record_expansion(ctx: Context<UpdateStats>) -> Result<()> {
        let game_stats = &mut ctx.accounts.game_stats;
        game_stats.grid_expansions = game_stats.grid_expansions.checked_add(1).unwrap();
        
        msg!("Grid expanded! Total expansions: {}", game_stats.grid_expansions);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + GameStats::INIT_SPACE,
        seeds = [b"game_stats"],
        bump
    )]
    pub game_stats: Account<'info, GameStats>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateStats<'info> {
    #[account(
        mut,
        seeds = [b"game_stats"],
        bump,
        has_one = authority
    )]
    pub game_stats: Account<'info, GameStats>,
    
    pub authority: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct GameStats {
    pub total_blocks_mined: u64,
    pub active_players: u64,
    pub grid_expansions: u64,
    pub longest_streak: u64,
    pub authority: Pubkey,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized access")]
    Unauthorized,
} 