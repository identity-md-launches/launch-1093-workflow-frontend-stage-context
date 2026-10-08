import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { formatUnits, getAddress, isAddress, parseUnits, zeroAddress, type Address } from 'viem';
import { loadConfig, shortAddress, type RuntimeConfig } from './config';
import { connectWallet, createEngine, readableError, switchNetwork, type ApprovalState, type Direction, type EIP1193Provider, type Snapshot, type SwapQuote, type TokenAction, type TransactionStatus } from './chain';

declare global { interface Window { ethereum?: EIP1193Provider } }
const amountText = (amount: bigint | undefined, decimals = 18, compact = false) => {
  if (amount === undefined) return '—';
  const value = formatUnits(amount, decimals);
  return compact ? Number(value).toLocaleString('en-US', {maximumFractionDigits: 5}) : value;
};
function parseAmount(value: string, decimals: number, allowZero = false) {
  if (!/^(\d+)(\.\d*)?$/.test(value.trim()) || (value.split('.')[1]?.length ?? 0) > decimals) throw new Error(`Enter an amount with at most ${decimals} decimal places.`);
  const parsed = parseUnits(value.trim(), decimals);
  if (parsed < 0n || (!allowZero && parsed === 0n)) throw new Error('Enter an amount greater than zero.');
  return parsed;
}
const addressValue = (value: string): Address => {
  if (!isAddress(value.trim()) || value.trim().toLowerCase() === zeroAddress) throw new Error('Enter a valid, nonzero Ethereum address.');
  return getAddress(value.trim());
};
function BrainArt() {
  const nodes = Array.from({length: 138}, (_, i) => {
    const angle = i * 2.39996; const r = Math.sqrt((i + 1) / 139);
    const side = Math.cos(angle) < 0 ? -1 : 1;
    const x = 240 + Math.cos(angle) * 156 * r + side * 13;
    const y = 113 + Math.sin(angle) * 86 * r + Math.cos(angle * 2) * 9;
    return {x, y};
  });
  return <div className="brain-art" aria-hidden="true"><svg viewBox="0 0 480 230" fill="none">
    <path d="M0 113h480M240 0v225" stroke="currentColor" strokeOpacity=".12" strokeDasharray="2 6" />
    {nodes.map((node,i) => <g key={i}>{nodes.slice(i+1).filter(other => Math.hypot(other.x-node.x,other.y-node.y)<34 && (other.x-240)*(node.x-240)>0).map((other,j) => <path key={j} d={`M${node.x} ${node.y}L${other.x} ${other.y}`} stroke="currentColor" strokeOpacity=".16" strokeWidth=".7"/>)}<circle cx={node.x} cy={node.y} r={i%9===0?3:1.7} fill="currentColor" opacity={i%9===0?1:.65}/></g>)}
  </svg><div className="art-caption"><span>Many minds. One idea.</span><span>Concept illustration / 001</span></div></div>;
}
function AddressLink({address, explorer, label}: {address: Address; explorer: string; label?: string}) {
  const [copied,setCopied] = useState(false);
  const [error,setError] = useState('');
  return <div><div className="address-row"><a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer">{label ?? shortAddress(address)} ↗</a><button type="button" onClick={async () => { try {await navigator.clipboard.writeText(getAddress(address));setCopied(true);setError('');} catch {setError('Copy unavailable. Select the full address below.');} }}>{copied?'Copied':'Copy address'}</button></div><span className="full-address">{getAddress(address)}</span><span role="status" className="note">{error}</span></div>;
}
export default function App() {
  const [config,setConfig] = useState<RuntimeConfig>();
  const [error,setError] = useState('');
  useEffect(() => {loadConfig().then(setConfig).catch(e => setError(readableError(e)));}, []);
  if (!config) return <main className="bootstrap"><div className="brand"><img src="./favicon.svg" alt=""/>swarm brain</div><h1 style={{fontSize:'2.5rem'}}>Intelligence in the open.</h1><p role={error?'alert':'status'}>{error || 'Loading the verified deployment…'}</p>{error&&<button onClick={() => location.reload()}>Reload page</button>}</main>;
  return <Site config={config}/>;
}
function Site({config}: {config: RuntimeConfig}) {
  const {manifest} = config;
  const [provider,setProvider] = useState<EIP1193Provider>();
  const [account,setAccount] = useState<Address>();
  const [chainId,setChainId] = useState<number>();
  const [walletBusy,setWalletBusy] = useState(false);
  const [walletError,setWalletError] = useState('');
  const engine = useMemo(() => createEngine(config,provider), [config,provider]);
  const [snapshot,setSnapshot] = useState<Snapshot>();
  const [verified,setVerified] = useState(false);
  const [readError,setReadError] = useState('');
  const [refresh,setRefresh] = useState(0);
  const [readAt,setReadAt] = useState<Date>();
  const [direction,setDirection] = useState<Direction>('buy');
  const [amount,setAmount] = useState('');
  const [slippage,setSlippage] = useState('0.5');
  const [quote,setQuote] = useState<SwapQuote>();
  const [approvals,setApprovals] = useState<ApprovalState>();
  const [quoteBusy,setQuoteBusy] = useState(false);
  const [tradeError,setTradeError] = useState('');
  const [tradeBusy,setTradeBusy] = useState('');
  const [tradeStatus,setTradeStatus] = useState<TransactionStatus>();
  const [toolBusy,setToolBusy] = useState(false);
  const [toolStatus,setToolStatus] = useState<TransactionStatus>();
  const [toolError,setToolError] = useState('');
  const [toolInvalid,setToolInvalid] = useState('');
  const [toolAction,setToolAction] = useState<TokenAction>('transfer');
  const [toolTo,setToolTo] = useState('');
  const [toolFrom,setToolFrom] = useState('');
  const [toolAmount,setToolAmount] = useState('');
  const [toolReview,setToolReview] = useState<{args: readonly unknown[]; text:string}>();
  const [toolAllowance,setToolAllowance] = useState<bigint>();
  const [toolReading,setToolReading] = useState(false);
  const busyRef = useRef(false);
  const contextKey = `${account}|${chainId}|${direction}|${amount}|${slippage}`;
  const contextRef = useRef(contextKey); contextRef.current = contextKey;
  const toolContextKey = `${account}|${chainId}|${toolAction}|${toolTo}|${toolFrom}|${toolAmount}`;
  const toolContextRef = useRef(toolContextKey); toolContextRef.current = toolContextKey;
  const connected = !!account;
  const wrongChain = connected && chainId !== manifest.chainId;
  const ready = connected && !wrongChain && verified && !!snapshot && !readError;
  const signing = !!tradeBusy || toolBusy;
  const input = direction==='buy'?engine.pair:engine.token;
  const output = direction==='buy'?engine.token:engine.pair;
  const balance = direction==='buy'?snapshot?.pairBalance:snapshot?.tokenBalance;
  useEffect(() => {
    let active = true; let reading = false;
    setVerified(false);setSnapshot(undefined);setReadAt(undefined);
    const read = async () => {
      if (reading || document.hidden) return;
      reading=true;
      try {const state=await engine.snapshot(account);if(active){setSnapshot(state);setVerified(true);setReadError('');setReadAt(new Date());}}
      catch(e){if(active){setReadError(readableError(e));setVerified(false);}}
      finally {reading=false;}
    };
    void read();const timer = setInterval(read,account?5000:15000);
    return () => {active=false;clearInterval(timer);};
  }, [engine,account,refresh]);
  useEffect(() => {
    if (!provider) return;
    const accountsChanged = (accounts: string[]) => {setAccount(accounts[0]?getAddress(accounts[0]):undefined);setWalletError('');};
    const chainChanged = (id: string) => setChainId(Number(id));
    const disconnected = () => {setAccount(undefined);setChainId(undefined);};
    provider.on('accountsChanged',accountsChanged);provider.on('chainChanged',chainChanged);provider.on('disconnect',disconnected);
    return () => {provider.removeListener('accountsChanged',accountsChanged);provider.removeListener('chainChanged',chainChanged);provider.removeListener('disconnect',disconnected);};
  }, [provider]);
  useEffect(() => {setQuote(undefined);setApprovals(undefined);setTradeError('');setToolReview(undefined);setToolAllowance(undefined);}, [amount,slippage,direction,account,chainId]);
  useEffect(() => {setToolReview(undefined);setToolAllowance(undefined);setToolError('');setToolInvalid('');}, [toolAction,toolTo,toolFrom,toolAmount]);
  useEffect(() => {
    if(!quote)return;
    const timer=setTimeout(()=>{setQuote(undefined);setApprovals(undefined);setTradeError('This quote expired. Get a fresh quote before continuing.');},Math.max(0,60000-(Date.now()-quote.quotedAt)));
    return()=>clearTimeout(timer);
  },[quote]);
  const connect = async () => {
    setWalletError('');setWalletBusy(true);
    try {const wallet=window.ethereum;if(!wallet)throw new Error('No browser wallet found. Open this page in an Ethereum wallet browser or install a compatible wallet extension.');setProvider(wallet);const result=await connectWallet(wallet);setAccount(result.account);setChainId(result.chainId);}
    catch(e){setWalletError(readableError(e));}finally{setWalletBusy(false);}
  };
  const switchChain = async () => {
    if(!provider)return;setWalletBusy(true);setWalletError('');
    try{await switchNetwork(config,provider);setChainId(Number(await provider.request({method:'eth_chainId'})));}catch(e){setWalletError(readableError(e));}finally{setWalletBusy(false);}
  };
  const getQuote = async () => {
    if(!account||!ready||busyRef.current)return;const requestContext=contextRef.current;setQuoteBusy(true);setTradeError('');setQuote(undefined);setTradeStatus(undefined);
    try {const parsed=parseAmount(amount,input.decimals);if(balance===undefined||parsed>balance)throw new Error(`Not enough ${input.symbol}. Reduce the amount or add funds to your wallet.`);
      if(!/^\d+(\.\d{1,2})?$/.test(slippage.trim()))throw new Error('Use slippage with at most two decimal places.');const basis=Number(parseUnits(slippage.trim(),2));
      const result=await engine.quote(direction,parsed,basis,account);const permissions=await engine.approvals(account,direction,parsed);if(requestContext===contextRef.current){setQuote(result);setApprovals(permissions);}
    }catch(e){if(requestContext===contextRef.current)setTradeError(readableError(e));}finally{setQuoteBusy(false);}
  };
  const trade = async () => {
    if(!account||!quote||!approvals||!ready||busyRef.current)return;
    const requestContext=contextRef.current;busyRef.current=true;const step=approvals.needsToken?'token':approvals.needsRouter?'router':'swap';setTradeBusy(step);setTradeError('');setTradeStatus(undefined);
    try{
      if(step==='token')await engine.approveToken(account,direction,quote.amountIn,setTradeStatus);
      else if(step==='router')await engine.approveRouter(account,direction,quote.amountIn,setTradeStatus);
      else await engine.swap(account,quote,setTradeStatus);
      const next=await engine.approvals(account,direction,quote.amountIn);
      if(requestContext===contextRef.current){setApprovals(next);if(step==='swap'){setQuote(undefined);setAmount('');}}
      setRefresh(v=>v+1);
    }catch(e){setTradeError(readableError(e));}finally{busyRef.current=false;setTradeBusy('');}
  };
  const reviewTool = async (event: FormEvent) => {
    event.preventDefault();if(!account||!ready||busyRef.current)return;const requestContext=toolContextRef.current;setToolError('');setToolStatus(undefined);setToolReview(undefined);setToolReading(true);
    try{
      const to=addressValue(toolTo);const value=parseAmount(toolAmount,snapshot?.decimals??18,true);
      if(to.toLowerCase()===engine.token.address.toLowerCase())throw new Error('Use a recipient or spender address other than the Brain token contract.');
      const units=`${formatUnits(value,snapshot?.decimals??18)} ${snapshot?.symbol??'Brain'}`;
      if(toolAction==='transfer'){
        if(value>(snapshot?.tokenBalance??0n))throw new Error('Not enough Brain. Reduce the amount or add tokens to your wallet.');
        setToolReview({args:[to,value],text:`Transfer ${units} to ${to}. Transfers cannot be reversed.`});
      } else if(toolAction==='approve') {
        const current=await engine.allowance(account,to);if(requestContext!==toolContextRef.current)return;setToolAllowance(current);
        if(current>0n&&value>0n)throw new Error('Revoke the existing allowance with amount 0 first, wait for confirmation, then set a new allowance.');
        setToolReview({args:[to,value],text:value===0n?`Revoke the Brain spending allowance for ${to}.`:`Allow ${to} to spend up to ${units} from your wallet.`});
      }else{
        const from=addressValue(toolFrom);const allowance=await engine.allowance(from,account);if(requestContext!==toolContextRef.current)return;setToolAllowance(allowance);
        if(allowance<value)throw new Error('The source wallet has not approved enough Brain for your connected account. Ask its owner to approve first.');
        setToolReview({args:[from,to,value],text:`Transfer ${units} from ${from} to ${to}, using your spending allowance.`});
      }
    }catch(e){if(requestContext!==toolContextRef.current)return;setToolError(readableError(e));const field=!isAddress(toolTo.trim())||toolTo.trim().toLowerCase()===zeroAddress||toolTo.trim().toLowerCase()===engine.token.address.toLowerCase()?'tool-to':toolAction==='transferFrom'&&(!isAddress(toolFrom.trim())||toolFrom.trim().toLowerCase()===zeroAddress)?'tool-from':'tool-amount';setToolInvalid(field);document.getElementById(field)?.focus();}finally{setToolReading(false);}
  };
  const submitTool=async()=>{
    if(!account||!toolReview||!ready||busyRef.current)return;busyRef.current=true;setToolBusy(true);setToolError('');
    try{await engine.writeToken(account,toolAction,toolReview.args,setToolStatus);setToolReview(undefined);setRefresh(v=>v+1);}catch(e){setToolError(readableError(e));}finally{busyRef.current=false;setToolBusy(false);}
  };
  const statusText=(status:TransactionStatus|undefined)=>!status?'':({simulating:'Checking this transaction…',signature:'Confirm the transaction in your wallet.',pending:'Transaction submitted. Waiting for confirmation…',confirmed:'Transaction confirmed.'}[status.stage]);
  const statusView=(status:TransactionStatus|undefined)=><div className="feedback" role="status">{statusText(status)}{status?.hash&&<> <a href={`${manifest.network.explorer}/tx/${status.hash}`} target="_blank" rel="noreferrer">View transaction ↗</a></>}</div>;
  const tradeLabel=tradeBusy?({token:'Approving token…',router:'Approving router…',swap:'Swapping…'}[tradeBusy]):approvals?.needsToken?`Approve ${input.symbol} for Permit2`:approvals?.needsRouter?`Approve ${input.symbol} for router`:`Swap ${input.symbol} for ${output.symbol}`;
  const fee=manifest.poolKey.fee/10000;
  return <><a className="skip" href="#main">Skip to content</a><div className="shell">
    <header className="header"><a className="brand" href="#main" aria-label="Swarm brain home"><img src="./favicon.svg" alt=""/>swarm brain</a><nav className="nav" aria-label="Main navigation"><a href="#about">The idea</a><a href="#contracts">Onchain details ↗</a><button className="wallet" disabled={walletBusy||signing} onClick={account?()=>{setAccount(undefined);setProvider(undefined);setChainId(undefined);}:connect}>{walletBusy?'Connecting…':account?`${shortAddress(account)} · Disconnect`:'Connect wallet'}</button></nav></header>
    <main id="main"><div className="hero"><section className="intro" aria-labelledby="hero-title"><div className="eyebrow"><span className="dot"/>A collective intelligence experiment</div><h1 id="hero-title">Many minds.<br/>One <em>brain.</em></h1><p className="lede">A brain made of hundreds of AI agents on stranger computers. Trading real money, in public.</p><a className="hero-link" href="#about">Meet Swarm brain <span aria-hidden="true">↗</span></a><BrainArt/></section>
    <section className="trade-card" aria-labelledby="trade-heading"><div className="card-title"><h2 id="trade-heading">Trade Brain</h2><span className="network-tag"><span className="dot"/>{manifest.network.name}</span></div>
      <div className="segment" role="group" aria-label="Trade direction"><button aria-pressed={direction==='buy'} disabled={signing||quoteBusy} onClick={()=>setDirection('buy')}>Buy Brain</button><button aria-pressed={direction==='sell'} disabled={signing||quoteBusy} onClick={()=>setDirection('sell')}>Sell Brain</button></div>
      <div className="amount-box"><div className="field-top"><label htmlFor="swap-amount">You pay</label><span title={amountText(balance,input.decimals)}>Balance: {account?amountText(balance,input.decimals,true):'—'}</span></div><div className="field-value"><input id="swap-amount" name="swap-amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} disabled={signing||quoteBusy} onChange={e=>setAmount(e.target.value)} aria-describedby="trade-error" aria-invalid={!!tradeError}/><span className="token-pill"><span className={`coin ${direction==='sell'?'brain':''}`} aria-hidden="true">{direction==='sell'?'B':'I'}</span>{input.symbol}</span></div></div>
      <div className="swap-divider" aria-hidden="true">↓</div>
      <div className="amount-box"><div className="field-top"><span>You receive</span><span>Estimated</span></div><div className="field-value"><output className="output" aria-label="Estimated output">{quote?amountText(quote.amountOut,output.decimals,true):'—'}</output><span className="token-pill"><span className={`coin ${direction==='buy'?'brain':''}`} aria-hidden="true">{direction==='buy'?'B':'I'}</span>{output.symbol}</span></div></div>
      <div className="trade-details"><div className="detail-row"><label htmlFor="slippage">Slippage tolerance (%)</label><span className="slippage"><input id="slippage" name="slippage" inputMode="decimal" value={slippage} disabled={signing||quoteBusy} onChange={e=>setSlippage(e.target.value)}/></span></div><div className="detail-row"><span>Pool fee</span><span>{fee}%</span></div>{quote&&<><div className="detail-row"><span>Minimum received</span><span>{amountText(quote.minimumOut,output.decimals)} {output.symbol}</span></div><div className="detail-row"><span>Quoted rate</span><span>1 {input.symbol} ≈ {(Number(formatUnits(quote.amountOut,output.decimals))/Number(formatUnits(quote.amountIn,input.decimals))).toLocaleString('en-US',{maximumSignificantDigits:6})} {output.symbol}</span></div></>}</div>
      {wrongChain&&<p className="notice">Your wallet is on another network. Switch to {manifest.network.name} to continue.</p>}
      {!account?<button className="primary" onClick={connect} disabled={walletBusy}>{walletBusy?'Connecting…':'Connect wallet to trade'}</button>:wrongChain?<button className="primary" onClick={switchChain} disabled={walletBusy}>{walletBusy?'Switching…':`Switch to ${manifest.network.name}`}</button>:quote&&approvals?<><p className="note" style={{marginBottom:'.8rem'}}>{approvals.needsToken?`Step 1 · Allow Permit2 to spend exactly ${amountText(quote.amountIn,input.decimals)} ${input.symbol}.`:approvals.needsRouter?'Step 2 · Allow the router to use this amount for 30 minutes.':`Review · Spend ${amountText(quote.amountIn,input.decimals)} ${input.symbol}; receive at least ${amountText(quote.minimumOut,output.decimals)} ${output.symbol}. Network fees are paid in ETH.`}</p><button className="primary" onClick={trade} disabled={!ready||signing||quoteBusy}>{tradeLabel}</button><button className="refresh" style={{marginTop:'.7rem'}} onClick={getQuote} disabled={!ready||signing||quoteBusy}>Refresh quote</button></>:<button className="primary" onClick={getQuote} disabled={!ready||signing||quoteBusy}>{quoteBusy?'Getting quote…':!verified?'Waiting for verified reads…':'Get quote'}</button>}
      <div className="feedback error" id="trade-error" role="alert">{tradeError}</div><div className="feedback error" role="alert">{walletError}</div>{statusView(tradeStatus)}
      {readError&&<div className="feedback error" role="alert">Live reads unavailable. {readError} <button className="refresh" onClick={()=>setRefresh(v=>v+1)}>Retry reads</button></div>}
      <p className="note trade-note">Trade via Uniswap v4 · Quotes expire after 60 seconds.<br/>USD pricing is unavailable. Amounts are shown in token units.</p>
    </section></div>
    <section className="stats" aria-label="Token and pool state"><div className="stat"><span className="stat-label">Total Brain supply</span><span className="stat-value">{amountText(snapshot?.totalSupply,snapshot?.decimals,true)}</span><span className="stat-meta">Fixed supply · no minting controls</span></div><div className="stat"><span className="stat-label">Your Brain balance</span><span className="stat-value">{account?amountText(snapshot?.tokenBalance,snapshot?.decimals,true):'Not connected'}</span><span className="stat-meta">{account?`${amountText(snapshot?.nativeBalance,18,true)} ETH available for gas`:'Connect a wallet to see your tokens'}</span></div><div className="stat"><span className="stat-label">Pool observation</span><span className="stat-value">{snapshot?.poolError?'Unavailable':snapshot?.sqrtPriceX96===0n?'Uninitialized':snapshot?.liquidity===0n?'No active liquidity':snapshot?.sqrtPriceX96?'Initialized':'Loading…'}</span><span className="stat-meta">{readAt?`Read at ${readAt.toLocaleTimeString()} · block ${snapshot?.blockNumber}`:'Waiting for a public RPC read'}</span></div></section>
    <section className="section about" id="about"><div><div className="eyebrow" style={{marginBottom:'1rem'}}>The idea</div><h2>Intelligence belongs in the open.</h2></div><div><p>Swarm brain is an experiment in collective intelligence: many independent minds, a shared direction, and an ambition to make their work visible.</p><p>This release gives you the Brain token and its onchain market. Agent activity, trading strategies, and performance data are not connected to this site. Holding Brain does not establish a claim on trading profits.</p></div></section>
    <section className="section" aria-label="Token utilities and transparency"><details className="disclosure" id="tools"><summary>Token tools</summary><div className="disclosure-content tool-grid"><form className="tool-form" onSubmit={reviewTool}>
      <label htmlFor="tool-action">Action<select id="tool-action" value={toolAction} disabled={signing||toolReading} onChange={e=>setToolAction(e.target.value as TokenAction)}><option value="transfer">Transfer</option><option value="approve">Approve / revoke</option><option value="transferFrom">Transfer from</option></select></label>
      {toolAction==='transferFrom'&&<label htmlFor="tool-from">Source wallet address<input id="tool-from" aria-invalid={toolInvalid==='tool-from'} aria-describedby="tool-error" autoComplete="off" spellCheck={false} value={toolFrom} disabled={signing||toolReading} onChange={e=>setToolFrom(e.target.value)}/></label>}
      <label htmlFor="tool-to">{toolAction==='approve'?'Spender address':'Recipient address'}<input id="tool-to" aria-invalid={toolInvalid==='tool-to'} autoComplete="off" spellCheck={false} value={toolTo} disabled={signing||toolReading} aria-describedby="tool-error" onChange={e=>setToolTo(e.target.value)}/></label>
      <label htmlFor="tool-amount">Amount (Brain)<input id="tool-amount" aria-invalid={toolInvalid==='tool-amount'} inputMode="decimal" autoComplete="off" value={toolAmount} disabled={signing||toolReading} aria-describedby="tool-error" onChange={e=>setToolAmount(e.target.value)}/></label>
      {toolAllowance!==undefined&&<p className="note">Current allowance: {amountText(toolAllowance,snapshot?.decimals)} Brain</p>}
      {!account?<p className="notice">Connect your wallet using the button above to use token tools.</p>:wrongChain?<p className="notice">Switch to {manifest.network.name} in the trade panel first.</p>:toolReview?<><p className="notice">{toolReview.text} You will also pay an ETH network fee.</p><button type="button" onClick={submitTool} disabled={!ready||signing}>{toolBusy?'Submitting…':toolAction==='transfer'?'Confirm transfer':toolAction==='approve'?'Confirm approval':'Confirm delegated transfer'}</button><button type="button" onClick={()=>setToolReview(undefined)} disabled={signing}>Edit details</button></>:<button type="submit" disabled={!ready||signing||toolReading}>{toolReading?'Reading allowance…':'Review transaction'}</button>}
      <div className="feedback error" id="tool-error" role="alert">{toolError}</div>{statusView(toolStatus)}
    </form><aside className="tool-aside"><h3>Direct token controls</h3><p>Transfer Brain to another wallet, set or revoke a spending allowance, or transfer tokens from a wallet that has approved you.</p><p>Approvals replace an allowance. Revoke an existing allowance with amount 0 before setting a new one. Check the full recipient and spender addresses before confirming.</p><p>This token has no owner settings, mint, pause, or upgrade controls.</p>{account&&<div style={{marginTop:'1rem'}}><p>Connected wallet</p><AddressLink address={account} explorer={manifest.network.explorer}/></div>}</aside></div></details>
    <details className="disclosure" id="contracts"><summary>Onchain details</summary><div className="disclosure-content"><div className="contract-list">{manifest.contracts.map(contract=><AddressLink key={contract.name} address={contract.address} explorer={manifest.network.explorer} label={`${contract.name} on ${manifest.network.name}`}/>)}</div><dl className="contract-meta"><div><dt>Deployment check</dt><dd>{verified?'RPC chain and deployed token code verified':'Awaiting verification'}</dd></div><div><dt>Pool ID</dt><dd>{engine.poolId}</dd></div><div><dt>Pool hook</dt><dd><a href={`${manifest.network.explorer}/address/${manifest.poolKey.hooks}`} target="_blank" rel="noreferrer">{manifest.poolKey.hooks} ↗</a></dd></div><div><dt>Pool currencies</dt><dd>{manifest.poolKey.currency0}<br/>{manifest.poolKey.currency1}</dd></div><div><dt>Pool parameters</dt><dd>{fee}% fee · tick spacing {manifest.poolKey.tickSpacing}</dd></div><div><dt>Current pool tick</dt><dd>{snapshot?.tick??'Unavailable'}</dd></div><div><dt>Active liquidity</dt><dd>{snapshot?.liquidity?.toString()??'Unavailable'} (pool units)</dd></div><div><dt>Source commit</dt><dd>{manifest.sourceCommit}</dd></div><div><dt>Attestation</dt><dd>{manifest.attestationHash}</dd></div></dl>{snapshot?.poolError&&<p className="feedback error">Pool state unavailable. {snapshot.poolError}</p>}<p className="note" style={{marginTop:'1rem'}}><a href="./imd-deployment.json" target="_blank" rel="noreferrer">View deployment manifest ↗</a> · <a href={`./${manifest.contracts[0].abiPath}`} target="_blank" rel="noreferrer">View implementation ABI ↗</a></p></div></details></section>
    </main><footer className="footer"><span>swarmbrain.fun</span><span>A shared experiment. An open ledger.</span><span>Brain / {manifest.network.name}</span></footer>
  </div></>;
}
