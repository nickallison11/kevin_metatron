use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum MetatronInstruction {
    CreatePitchRecord {
        org_id: [u8; 16],
        pitch_id: [u8; 16],
        version: u32,
        pitch_hash: [u8; 32],
        document_hash: [u8; 32],
        jurisdiction_country: [u8; 2],
    },
    UpdatePitchRecordVersion {
        pitch_id: [u8; 16],
        version: u32,
        pitch_hash: [u8; 32],
        document_hash: [u8; 32],
    },
    CreatePool {
        pool_id: [u8; 16],
        manifest_hash: [u8; 32],
    },
    RecordPoolManifest {
        pool_id: [u8; 16],
        manifest_hash: [u8; 32],
    },
    RecordInvestmentCommitment {
        commitment_id: [u8; 16],
        pool_id: [u8; 16],
        pitch_id: [u8; 16],
        investor_id: [u8; 16],
        amount_minor_units: u64,
        is_stablecoin: bool,
        tx_hash: [u8; 32],
    },
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct PitchRecord {
    pub org_id: [u8; 16],
    pub pitch_id: [u8; 16],
    pub version: u32,
    pub pitch_hash: [u8; 32],
    pub document_hash: [u8; 32],
    pub jurisdiction_country: [u8; 2],
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct PoolRecord {
    pub pool_id: [u8; 16],
    pub manifest_hash: [u8; 32],
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct InvestmentCommitmentRecord {
    pub commitment_id: [u8; 16],
    pub pool_id: [u8; 16],
    pub pitch_id: [u8; 16],
    pub investor_id: [u8; 16],
    pub amount_minor_units: u64,
    pub is_stablecoin: bool,
    pub tx_hash: [u8; 32],
}

entrypoint!(process_instruction);

pub fn process_instruction(
    _program_id: &Pubkey,
    _accounts: &[AccountInfo],
    _input: &[u8],
) -> ProgramResult {
    // For the MVP skeleton we only decode and log; state layout and account
    // management will be implemented in later iterations.
    let instruction = MetatronInstruction::try_from_slice(_input)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    match instruction {
        MetatronInstruction::CreatePitchRecord { .. } => {
            msg!("CreatePitchRecord");
        }
        MetatronInstruction::UpdatePitchRecordVersion { .. } => {
            msg!("UpdatePitchRecordVersion");
        }
        MetatronInstruction::CreatePool { .. } => {
            msg!("CreatePool");
        }
        MetatronInstruction::RecordPoolManifest { .. } => {
            msg!("RecordPoolManifest");
        }
        MetatronInstruction::RecordInvestmentCommitment { .. } => {
            msg!("RecordInvestmentCommitment");
        }
    }

    Ok(())
}

