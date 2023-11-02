import React from 'react';
import './app.scss';
import { useSDK } from '@metamask/sdk-react';
import { Buffer } from 'buffer';
import * as ethers from 'ethers';
import Moralis from 'moralis';
import { EvmChain, EvmNft } from '@moralisweb3/evm-utils';

window.Buffer = Buffer;

let _moralisStarted = false;
const lnbContractAddress = "0xbcE690cb71b727ce476c73cAf6B734aff14b665f";

function App() {
	const [moralisStarted, setMoralisStarted] = React.useState<boolean>(_moralisStarted);
	const [nfts, setNFTs] = React.useState<EvmNft[]>([]);
	const [balance, setBalance] = React.useState<number>(0);
	const [debt, setDebt] = React.useState<number>(0);
	const [borrowCapacity, setBorrowCapacity] = React.useState<number>(0);

	const { sdk, account, connected, provider, chainId } = useSDK();

	const connect = async () => {
		try {
			await sdk?.connect();
		} catch(ex) {
			console.warn(`failed to connect`, ex);
		}
	}

	const getSigner = async () => {
		if(!connected) await connect();
		if(provider) {
			const browserProvider = new ethers.BrowserProvider(provider as any);
			return await browserProvider.getSigner();
		}
	}

	const getLNBContract = async () => {
		const signer = await getSigner();
		if(signer) {
			return new ethers.Contract(lnbContractAddress, [
				"function lend() public payable",
				"function borrow(uint amount) public",
				"function wihtdraw(uint amount) public",
				"function repay() public payable",
				"function deposit(address nftAddress, uint tokenId) public",
				"function withdrawCollateral(address nftAddress, uint tokenId) public",
				"function isCollateralized(address nftAddress, uint tokenId) public view returns(bool)",
				"function myBalance() public view returns(uint)",
				"function myDebt() public view returns(uint)",
				"function myBorrowCapacity() public view returns(uint)",
			], signer);
		}
	}

	const getNFTContract = async (address: string) => {
		const signer = await getSigner();
		if(signer) {
			return new ethers.Contract(address, [
				"function claimNFT() public returns (uint256)",
				"function getApproved(uint256 tokenId) public view returns(address)",
				"function approve(address to, uint256 tokenId) public",
			], signer);
		}
	}

	const init = () => {
		if(!_moralisStarted && !moralisStarted) {
			try {
				Moralis.start({
					apiKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6IjE0YzdmYzU0LTMzYTAtNDlmYS1iODJkLTFkYjNjMTFkYjI5ZCIsIm9yZ0lkIjoiMzYzMTMzIiwidXNlcklkIjoiMzczMjA4IiwidHlwZUlkIjoiZjFjNWYyYTMtMDMzNC00OTc1LWFmM2MtNDg3NDE1ZWE5MDA0IiwidHlwZSI6IlBST0pFQ1QiLCJpYXQiOjE2OTg5NDkxMzUsImV4cCI6NDg1NDcwOTEzNX0.vo-6s1IoMLQBB8aK2gFXbZBK2DwyjR0u-Qrha1u0Jmc",
				}).then(async _ => {
					setMoralisStarted(true);
				});
				_moralisStarted = true;
			} catch(ex) {
				console.warn(ex);
			}
		}
	}

	const loadNFTs = () => {
		if(moralisStarted && account) {
			(async () => {
				const newNFTs: EvmNft[] = [];

				const chain = EvmChain.GOERLI; // chainId;

				const freeResponse = await Moralis.EvmApi.nft.getWalletNFTs({
					address: account,
					chain,
				});
				do {
					newNFTs.push(...freeResponse.result);
					if(freeResponse.hasNext())
						freeResponse.next();
				} while(freeResponse.hasNext());

				const depositedResponse = await Moralis.EvmApi.nft.getWalletNFTs({
					address: lnbContractAddress,
					chain,
				});
				const contract = await getLNBContract();
				if(contract) {
					do {
						for(const nft of depositedResponse.result) {
							if(await contract.isCollateralized(nft.tokenAddress.lowercase, BigInt(Number(nft.tokenId))))
								newNFTs.push(nft);
						}
						if(depositedResponse.hasNext()) depositedResponse.next();
					} while(depositedResponse.hasNext());
				}

				setNFTs(newNFTs);
			})();
		}
	}

	const loadStates = () => {
		getLNBContract().then(async contract => {
			if(contract) {
				setBalance(Number(await contract.myBalance()) / 1e18);
				setDebt(Number(await contract.myDebt()) / 1e18);
				setBorrowCapacity(Number(await contract.myBorrowCapacity()) / 1e18);
			}
		});
	}

	React.useEffect(init, []);
	React.useEffect(loadNFTs, [moralisStarted, account]);
	React.useEffect(loadStates, [provider]);
	React.useEffect(loadStates, [account]);

	const lend = () => {
		getLNBContract().then(async contract => {
			if(contract) {
				contract.lend({ value: BigInt(0.001 * 1e18) }).then(async tx => {
					await tx.wait();
					loadStates();
				});
			}
		});
	}

	const withdraw = () => {
		getLNBContract().then(async contract => {
			if(contract) {
				contract.wihtdraw(BigInt(0.001 * 1e18)).then(async tx => {
					await tx.wait();
					loadStates();
				});
			}
		});
	}

	const payDebt = () => {
		getLNBContract().then(async contract => {
			if(contract) {
				contract.repay({ value: BigInt(Math.round(debt * 1e18)) }).then(async tx => {
					await tx.wait();
					loadStates();
				});
			}
		});
	}

	const borrow = () => {
		getLNBContract().then(async contract => {
			if(contract) {
				contract.borrow(BigInt(0.001 * 1e18)).then(async tx => {
					await tx.wait();
					loadStates();
				});
			}
		});
	}

	const postCollateral = (nftAddress: string, tokenId: number) => {
		return () => {
			getNFTContract(nftAddress).then(async nftContract => {
				if(nftContract) {
					const isApproved = (await nftContract.getApproved(BigInt(tokenId))).toLowerCase() === lnbContractAddress.toLowerCase();
					if(!isApproved) {
						const approveTx = await nftContract.approve(lnbContractAddress, BigInt(tokenId));
						await approveTx.wait();
					}

					const contract = await getLNBContract();
					if(contract) {
						const tx = await contract.deposit(nftAddress, BigInt(tokenId));
						await tx.wait();
						loadNFTs();
						loadStates();
					}
				}
			});
		}
	}

	const withdrawCollateral = (nftAddress: string, tokenId: number) => {
		return () => {
			getLNBContract().then(async contract => {
				if(contract) {
					contract.withdrawCollateral(nftAddress, BigInt(tokenId)).then(async tx => {
						await tx.wait();
						loadNFTs();
						loadStates();
					});
				}
			});
		}
	}

	const claimNFT = () => {
		getNFTContract("0xa22311570fFD31938099174456823a60A42fbd6D").then(async contract => {
			if(contract) {
				contract.claimNFT().then(async tx => {
					await tx.wait();
					loadNFTs();
				});
			}
		});
	}

	return (
		<div id="app">
			<h1>Consensys Assessment - Lucas Yamamoto</h1>
			{account && <div>Your address: {account}</div>}
			<div id="summary">
				<div id="balance" className="summary-item">
					<h3>Balance</h3>
					<div>{balance} eth</div>
					<div>
						<button onClick={lend}>Lend 0.001 eth</button>
						{balance > 0.001 && <button onClick={withdraw}>Withdraw 0.001 eth</button>}
					</div>
				</div>
				<div id="debt" className="summary-item">
					<h3>Debt</h3>
					<div>{debt} eth</div>
					<div>{debt > 0 && <button onClick={payDebt}>Pay debt</button>}</div>
				</div>
				<div id="borrow-capacity" className="summary-item">
					<h3>Borrow Capacity</h3>
					<div>{borrowCapacity - debt} eth</div>
					<div>{borrowCapacity - debt > 0.001 && <button onClick={borrow}>Borrow 0.001 eth</button>}</div>
				</div>
			</div>
			<div id="nfts">
				<h2>My NFTs</h2>
				<div id="nft-list">
					{nfts.map((nft, i) => (
						<div key={`nft-${i}`} className="nft">
							<h3>{nft.name} ({nft.symbol})</h3>
							<div><small>{nft.tokenAddress.lowercase}</small></div>
							<div>#{nft.tokenId}</div>
							{nft.ownerOf?.lowercase === account?.toLowerCase() ?
								<button onClick={postCollateral(nft.tokenAddress.lowercase, Number(nft.tokenId))}>Deposit as collateral</button> :
								<button onClick={withdrawCollateral(nft.tokenAddress.lowercase, Number(nft.tokenId))}>Withdraw NFT</button>
							}
						</div>
					))}
				</div>
				<button onClick={claimNFT}>Claim NFT</button>
			</div>
	  	</div>
	);
}

export default App;

