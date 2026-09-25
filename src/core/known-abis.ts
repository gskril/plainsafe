// Bundled ABIs for standard interfaces (SPEC §7.1 level 3 "bundled"). A function from these is
// only used when its selector is in the target's bytecode (SPEC §7.3).
import { erc20Abi, erc721Abi, parseAbi } from 'viem'

export const wethAbi = parseAbi(['function deposit() payable', 'function withdraw(uint256 wad)'])

export const safeManagementAbi = parseAbi([
  'function addOwnerWithThreshold(address owner, uint256 _threshold)',
  'function removeOwner(address prevOwner, address owner, uint256 _threshold)',
  'function swapOwner(address prevOwner, address oldOwner, address newOwner)',
  'function changeThreshold(uint256 _threshold)',
  'function enableModule(address module)',
  'function disableModule(address prevModule, address module)',
  'function setGuard(address guard)',
  'function setModuleGuard(address moduleGuard)',
  'function setFallbackHandler(address handler)',
  'function approveHash(bytes32 hashToApprove)',
])

export const erc1155Abi = parseAbi([
  'function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes data)',
  'function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] values, bytes data)',
  'function setApprovalForAll(address operator, bool approved)',
])

export const knownAbis = [
  { name: 'ERC-20', abi: erc20Abi },
  { name: 'ERC-721', abi: erc721Abi },
  { name: 'ERC-1155', abi: erc1155Abi },
  { name: 'WETH', abi: wethAbi },
  { name: 'Safe', abi: safeManagementAbi },
] as const
